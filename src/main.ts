import { Editor, MarkdownView, Notice, Plugin } from 'obsidian'

import { ApplyView } from './ApplyView'
import { ChatView } from './ChatView'
import { ChatProps } from './components/chat-view/Chat'
import { InstallerUpdateRequiredModal } from './components/modals/InstallerUpdateRequiredModal'
import { APPLY_VIEW_TYPE, CHAT_VIEW_TYPE } from './constants'
import { McpManager } from './core/mcp/mcpManager'
import { RAGEngine } from './core/rag/ragEngine'
import { setupEditorAutocomplete } from './editor-plugins/autocomplete/ObsidianEditorExtension'
import { DatabaseManager } from './database/DatabaseManager'
import { PGLiteAbortedException } from './database/exception'
import { migrateToJsonDatabase } from './database/json/migrateToJsonDatabase'
import {
  SmartComposerSettings,
  smartComposerSettingsSchema,
} from './settings/schema/setting.types'
import { parseSmartComposerSettings } from './settings/schema/settings'
import { SmartComposerSettingTab } from './settings/SettingTab'
import { getMentionableBlockData } from './utils/obsidian'

/**
 * TODO: Autocomplete Feature for Main Editor
 * 
 * In the future, implement cursor-style autocomplete for the main Obsidian editor:
 * - See implementation files in src/editor-plugins/autocomplete/
 * - Will require creating a CodeMirror extension to hook into the editor
 * - Should show real-time completion suggestions as user types
 * - Can reuse existing LLM provider code for generating completions
 */

export default class SmartComposerPlugin extends Plugin {
  settings: SmartComposerSettings
  initialChatProps?: ChatProps // TODO: change this to use view state like ApplyView
  settingsChangeListeners: ((newSettings: SmartComposerSettings) => void)[] = []
  mcpManager: McpManager | null = null
  dbManager: DatabaseManager | null = null
  ragEngine: RAGEngine | null = null
  private dbManagerInitPromise: Promise<DatabaseManager> | null = null
  private ragEngineInitPromise: Promise<RAGEngine> | null = null
  private timeoutIds: ReturnType<typeof setTimeout>[] = [] // Use ReturnType instead of number
  private editorAutocompleteCleanup: (() => void) | null = null

  async onload() {
    await this.loadSettings()

    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this))
    this.registerView(APPLY_VIEW_TYPE, (leaf) => new ApplyView(leaf))

    // This creates an icon in the left ribbon.
    this.addRibbonIcon('wand-sparkles', 'Open smart composer', () =>
      this.openChatView(),
    )

    // Set up editor autocomplete if enabled
    if (this.settings.editorAutocomplete.enabled) {
      this.setupEditorAutocomplete()
    }

    // This adds a simple command that can be triggered anywhere
    this.addCommand({
      id: 'open-new-chat',
      name: 'Toggle chat view',
      callback: () => this.toggleChatView(),
    })

    this.addCommand({
      id: 'add-selection-to-chat',
      name: 'Add selection to chat',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        this.addSelectionToChat(editor, view)
      },
    })

    // Command to accept changes in the apply view
    this.addCommand({
      id: 'accept-changes',
      name: 'Accept changes in apply view',
      checkCallback: (checking) => {
        // Check if an ApplyView is active
        const applyView = this.app.workspace.getActiveViewOfType(ApplyView);
        if (!applyView) return false;
        
        if (checking) return true;
        
        // Execute the accept changes action
        applyView.acceptChanges();
        return true;
      },
      hotkeys: [
        {
          modifiers: ["Mod"],
          key: "Enter",
        },
      ],
    });

    // Command to reject changes in the apply view
    this.addCommand({
      id: 'reject-changes',
      name: 'Reject changes in apply view',
      checkCallback: (checking) => {
        // Check if an ApplyView is active
        const applyView = this.app.workspace.getActiveViewOfType(ApplyView);
        if (!applyView) return false;
        
        if (checking) return true;
        
        // Execute the reject changes action
        applyView.rejectChanges();
        return true;
      },
      hotkeys: [
        {
          modifiers: [],
          key: "Escape",
        },
      ],
    });

    // Command to accept current autocomplete suggestion
    this.addCommand({
      id: 'accept-autocomplete',
      name: 'Accept current autocomplete suggestion',
      editorCallback: () => {
        // Find the ghost element
        const ghostElement = document.querySelector('.smtcmp-autocomplete-ghost-text') as HTMLElement | null;
        if (!ghostElement || ghostElement.style.display === 'none') return;
        
        // Get the suggestion text
        const ghostText = ghostElement.querySelector('.smtcmp-autocomplete-ghost-cursor')?.textContent;
        if (!ghostText) return;
        
        // Get the active editor
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) return;
        
        const editor = activeView.editor;
        if (!editor) return;
        
        // Insert the suggestion at cursor position
        const cursor = editor.getCursor();
        editor.replaceRange(ghostText, cursor, cursor);
        
        // Move cursor to end of inserted text
        const newCursorPos = {
          line: cursor.line,
          ch: cursor.ch + ghostText.length
        };
        editor.setCursor(newCursorPos);
        
        // Hide the ghost element
        ghostElement.style.display = 'none';
      },
      hotkeys: [
        {
          modifiers: [],
          key: "Tab",
        },
      ],
    });

    // Command to dismiss current autocomplete suggestion
    this.addCommand({
      id: 'dismiss-autocomplete',
      name: 'Dismiss current autocomplete suggestion',
      editorCallback: () => {
        // Find the ghost element
        const ghostElement = document.querySelector('.smtcmp-autocomplete-ghost-text') as HTMLElement | null;
        if (!ghostElement || ghostElement.style.display === 'none') return;
        
        // Hide the ghost element
        ghostElement.style.display = 'none';
      },
      hotkeys: [
        {
          modifiers: [],
          key: "Escape",
        },
      ],
    });

    this.addCommand({
      id: 'rebuild-vault-index',
      name: 'Rebuild entire vault index',
      callback: async () => {
        const notice = new Notice('Rebuilding vault index...', 0)
        try {
          const ragEngine = await this.getRAGEngine()
          await ragEngine.updateVaultIndex(
            { reindexAll: true },
            (queryProgress) => {
              if (queryProgress.type === 'indexing') {
                const { completedChunks, totalChunks } =
                  queryProgress.indexProgress
                notice.setMessage(
                  `Indexing chunks: ${completedChunks} / ${totalChunks}${
                    queryProgress.indexProgress.waitingForRateLimit
                      ? '\n(waiting for rate limit to reset)'
                      : ''
                  }`,
                )
              }
            },
          )
          notice.setMessage('Rebuilding vault index complete')
        } catch (error) {
          console.error(error)
          notice.setMessage('Rebuilding vault index failed')
        } finally {
          this.registerTimeout(() => {
            notice.hide()
          }, 1000)
        }
      },
    })

    this.addCommand({
      id: 'update-vault-index',
      name: 'Update index for modified files',
      callback: async () => {
        const notice = new Notice('Updating vault index...', 0)
        try {
          const ragEngine = await this.getRAGEngine()
          await ragEngine.updateVaultIndex(
            { reindexAll: false },
            (queryProgress) => {
              if (queryProgress.type === 'indexing') {
                const { completedChunks, totalChunks } =
                  queryProgress.indexProgress
                notice.setMessage(
                  `Indexing chunks: ${completedChunks} / ${totalChunks}${
                    queryProgress.indexProgress.waitingForRateLimit
                      ? '\n(waiting for rate limit to reset)'
                      : ''
                  }`,
                )
              }
            },
          )
          notice.setMessage('Vault index updated')
        } catch (error) {
          console.error(error)
          notice.setMessage('Vault index update failed')
        } finally {
          this.registerTimeout(() => {
            notice.hide()
          }, 1000)
        }
      },
    })

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new SmartComposerSettingTab(this.app, this))

    void this.migrateToJsonStorage()
  }

  onunload() {
    // Clean up editor autocomplete
    if (this.editorAutocompleteCleanup) {
      this.editorAutocompleteCleanup()
      this.editorAutocompleteCleanup = null
    }
    
    // clear all timers
    this.timeoutIds.forEach((id) => clearTimeout(id))
    this.timeoutIds = []

    // RagEngine cleanup
    this.ragEngine?.cleanup()
    this.ragEngine = null

    // Promise cleanup
    this.dbManagerInitPromise = null
    this.ragEngineInitPromise = null

    // DatabaseManager cleanup
    this.dbManager?.cleanup()
    this.dbManager = null

    // McpManager cleanup
    this.mcpManager?.cleanup()
    this.mcpManager = null
  }

  async loadSettings() {
    this.settings = parseSmartComposerSettings(await this.loadData())
    await this.saveData(this.settings) // Save updated settings
  }

  async setSettings(newSettings: SmartComposerSettings) {
    const validationResult = smartComposerSettingsSchema.safeParse(newSettings)

    if (!validationResult.success) {
      new Notice(`Invalid settings:
${validationResult.error.issues.map((v) => v.message).join('\n')}`)
      return
    }

    // Check if editor autocomplete was enabled/disabled
    const wasAutocompleteEnabled = this.settings.editorAutocomplete.enabled
    const isAutocompleteEnabled = newSettings.editorAutocomplete.enabled

    this.settings = newSettings
    await this.saveData(newSettings)
    this.ragEngine?.setSettings(newSettings)
    this.settingsChangeListeners.forEach((listener) => listener(newSettings))

    // Handle autocomplete setting changes
    if (wasAutocompleteEnabled !== isAutocompleteEnabled) {
      if (isAutocompleteEnabled) {
        this.setupEditorAutocomplete()
      } else if (this.editorAutocompleteCleanup) {
        this.editorAutocompleteCleanup()
        this.editorAutocompleteCleanup = null
      }
    }
  }

  // Set up editor autocomplete
  private setupEditorAutocomplete() {
    // Clean up any existing autocomplete
    if (this.editorAutocompleteCleanup) {
      this.editorAutocompleteCleanup()
      this.editorAutocompleteCleanup = null
    }
    
    try {
      this.editorAutocompleteCleanup = setupEditorAutocomplete(this, this.settings)
      console.log('Editor autocomplete enabled')
    } catch (error) {
      console.error('Failed to setup editor autocomplete:', error)
      new Notice('Failed to set up editor autocomplete. Please check the console for details.')
    }
  }

  addSettingsChangeListener(
    listener: (newSettings: SmartComposerSettings) => void,
  ) {
    this.settingsChangeListeners.push(listener)
    return () => {
      this.settingsChangeListeners = this.settingsChangeListeners.filter(
        (l) => l !== listener,
      )
    }
  }

  async openChatView(openNewChat = false) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView)
    const editor = view?.editor
    if (!view || !editor) {
      this.activateChatView(undefined, openNewChat)
      return
    }
    const selectedBlockData = await getMentionableBlockData(editor, view)
    this.activateChatView(
      {
        selectedBlock: selectedBlockData ?? undefined,
      },
      openNewChat,
    )
  }

  async activateChatView(chatProps?: ChatProps, openNewChat = false) {
    // chatProps is consumed in ChatView.tsx
    this.initialChatProps = chatProps

    const leaf = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0]

    await (leaf ?? this.app.workspace.getRightLeaf(false))?.setViewState({
      type: CHAT_VIEW_TYPE,
      active: true,
    })

    if (openNewChat && leaf && leaf.view instanceof ChatView) {
      leaf.view.openNewChat(chatProps?.selectedBlock)
    }

    this.app.workspace.revealLeaf(
      this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0],
    )
  }

  async addSelectionToChat(editor: Editor, view: MarkdownView) {
    const data = await getMentionableBlockData(editor, view)
    if (!data) return

    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)
    if (leaves.length === 0 || !(leaves[0].view instanceof ChatView)) {
      await this.activateChatView({
        selectedBlock: data,
      })
      return
    }

    // bring leaf to foreground (uncollapse sidebar if it's collapsed)
    await this.app.workspace.revealLeaf(leaves[0])

    const chatView = leaves[0].view
    chatView.addSelectionToChat(data)
    chatView.focusMessage()
  }

  async getDbManager(): Promise<DatabaseManager> {
    if (this.dbManager) {
      return this.dbManager
    }

    if (!this.dbManagerInitPromise) {
      this.dbManagerInitPromise = (async () => {
        try {
          this.dbManager = await DatabaseManager.create(this.app)
          return this.dbManager
        } catch (error) {
          this.dbManagerInitPromise = null
          if (error instanceof PGLiteAbortedException) {
            new InstallerUpdateRequiredModal(this.app).open()
          }
          throw error
        }
      })()
    }

    // if initialization is running, wait for it to complete instead of creating a new initialization promise
    return this.dbManagerInitPromise
  }

  async getRAGEngine(): Promise<RAGEngine> {
    if (this.ragEngine) {
      return this.ragEngine
    }

    if (!this.ragEngineInitPromise) {
      this.ragEngineInitPromise = (async () => {
        try {
          const dbManager = await this.getDbManager()
          this.ragEngine = new RAGEngine(
            this.app,
            this.settings,
            dbManager.getVectorManager(),
          )
          return this.ragEngine
        } catch (error) {
          this.ragEngineInitPromise = null
          throw error
        }
      })()
    }

    return this.ragEngineInitPromise
  }

  async getMcpManager(): Promise<McpManager> {
    if (this.mcpManager) {
      return this.mcpManager
    }

    try {
      this.mcpManager = new McpManager({
        settings: this.settings,
        registerSettingsListener: (
          listener: (settings: SmartComposerSettings) => void,
        ) => this.addSettingsChangeListener(listener),
      })
      await this.mcpManager.initialize()
      return this.mcpManager
    } catch (error) {
      this.mcpManager = null
      throw error
    }
  }

  private registerTimeout(callback: () => void, timeout: number): void {
    const timeoutId = setTimeout(callback, timeout)
    this.timeoutIds.push(timeoutId)
  }

  private async migrateToJsonStorage() {
    try {
      const dbManager = await this.getDbManager()
      await migrateToJsonDatabase(this.app, dbManager, async () => {
        await this.reloadChatView()
        console.log('Migration to JSON storage completed successfully')
      })
    } catch (error) {
      console.error('Failed to migrate to JSON storage:', error)
      new Notice(
        'Failed to migrate to JSON storage. Please check the console for details.',
      )
    }
  }

  private async reloadChatView() {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)
    if (leaves.length === 0 || !(leaves[0].view instanceof ChatView)) {
      return
    }
    new Notice('Reloading "smart-composer" due to migration', 1000)
    leaves[0].detach()
    await this.activateChatView()
  }

  async toggleChatView() {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    
    // If chat view is already open
    if (leaves.length > 0) {
      // Check if the sidebar containing chat is collapsed
      let isSidebarCollapsed = false;
      
      try {
        // @ts-ignore - We're handling type issues at runtime
        const rightSplit = this.app.workspace.rightSplit;
        // @ts-ignore - We're handling type issues at runtime
        const leftSplit = this.app.workspace.leftSplit;
        
        // If we have a right sidebar with leaves and it's not collapsed
        if (rightSplit && !rightSplit.collapsed && this.isLeafInSplit(leaves[0], rightSplit)) {
          rightSplit.collapse();
          return;
        }
        
        // If we have a left sidebar with leaves and it's not collapsed
        if (leftSplit && !leftSplit.collapsed && this.isLeafInSplit(leaves[0], leftSplit)) {
          leftSplit.collapse();
          return;
        }
        
        // If we get here, the sidebar is likely collapsed, so we should expand it
        // Reveal the leaf which effectively expands the sidebar
        this.app.workspace.revealLeaf(leaves[0]);
        
        // Focus the chat input after revealing the leaf
        setTimeout(() => {
          if (leaves[0].view instanceof ChatView) {
            leaves[0].view.focusMessage();
          }
        }, 100);
        
        return;
        
      } catch (e) {
        console.error("Error toggling sidebar:", e);
        // Fallback to standard behavior
        this.app.workspace.revealLeaf(leaves[0]);
        
        // Still try to focus the chat input
        setTimeout(() => {
          if (leaves[0].view instanceof ChatView) {
            leaves[0].view.focusMessage();
          }
        }, 100);
      }
      return;
    }
    
    // No chat view open, so open a new one
    await this.openChatView(true);
    
    // Focus the chat input after opening
    setTimeout(() => {
      const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
      if (leaves.length > 0 && leaves[0].view instanceof ChatView) {
        leaves[0].view.focusMessage();
      }
    }, 100);
  }
  
  // Helper method to check if a leaf is in a specific split
  private isLeafInSplit(leaf: any, split: any): boolean {
    try {
      // @ts-ignore - Try to find the leaf in the leaves of the split
      return split.children.some((child: any) => 
        child.children && child.children.some((grandchild: any) => grandchild === leaf)
      );
    } catch (e) {
      // If we can't determine it, assume false
      return false;
    }
  }
}
