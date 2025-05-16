import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { Plugin, MarkdownView, Notice } from 'obsidian';
import { CompletionRequest, CompletionResponse } from '../../core/llm/base';
import { getChatModelClient } from '../../core/llm/manager';
import { SmartComposerSettings } from '../../settings/schema/setting.types';

// The view plugin for CodeMirror 6
export const autocompleteEditorPlugin = (plugin: Plugin, settings: SmartComposerSettings) => {
  return ViewPlugin.fromClass(class {
    private view: EditorView;
    private completionTimeout: number | null = null;
    private ghostElement: HTMLElement | null = null;
    private currentSuggestion: string | null = null;
    private isGenerating = false;
    private abortController: AbortController | null = null;

    constructor(view: EditorView) {
      this.view = view;
      this.createGhostElement();
    }

    // Create a ghost text element for showing completions
    private createGhostElement() {
      this.ghostElement = document.createElement('div');
      this.ghostElement.className = 'smtcmp-autocomplete-ghost-text';
      
      const cursorElement = document.createElement('span');
      cursorElement.className = 'smtcmp-autocomplete-ghost-cursor';
      this.ghostElement.appendChild(cursorElement);
      
      document.body.appendChild(this.ghostElement);
      this.hideGhostElement();
    }

    private showGhostElement(text: string, position: { top: number, left: number }) {
      if (!this.ghostElement) return;
      
      const cursorElement = this.ghostElement.querySelector('.smtcmp-autocomplete-ghost-cursor');
      if (cursorElement) {
        cursorElement.textContent = text;
      }
      
      this.ghostElement.style.position = 'fixed';
      this.ghostElement.style.top = `${position.top}px`;
      this.ghostElement.style.left = `${position.left}px`;
      this.ghostElement.style.display = 'block';
      
      // Apply any editor-specific adjustments
      const computedStyle = window.getComputedStyle(document.querySelector('.cm-content') || document.body);
      this.ghostElement.style.fontFamily = computedStyle.fontFamily;
      this.ghostElement.style.fontSize = computedStyle.fontSize;
      this.ghostElement.style.lineHeight = computedStyle.lineHeight;
    }

    private hideGhostElement() {
      if (this.ghostElement) {
        this.ghostElement.style.display = 'none';
      }
    }

    // Get cursor position
    private getCursorPosition(): { top: number, left: number } | null {
      const { view } = this;
      
      try {
        const selection = view.state.selection.main;
        if (selection.empty) {
          const pos = view.coordsAtPos(selection.head);
          if (pos) {
            // Add a small offset to better align with the text
            return {
              top: Math.floor(pos.top), // Floor to avoid sub-pixel positioning issues
              left: Math.floor(pos.right) // Use right to position after cursor
            };
          }
        }
      } catch (error) {
        console.error('Error getting cursor position:', error);
      }
      
      return null;
    }

    // Get the current text before cursor
    private getTextBeforeCursor(): string {
      const { view } = this;
      const selection = view.state.selection.main;
      
      if (selection.empty) {
        // Get the current line up to the cursor
        const line = view.state.doc.lineAt(selection.head);
        const textUpToCursor = line.text.substring(0, selection.head - line.from);
        return textUpToCursor;
      }
      
      return '';
    }

    // Generate completion based on the text
    private async generateCompletion(text: string) {
      if (this.isGenerating || text.trim().length < settings.editorAutocomplete.minChars) {
        return;
      }
      
      try {
        this.isGenerating = true;
        
        // Cancel any ongoing requests
        if (this.abortController) {
          this.abortController.abort();
        }
        
        // Create new abort controller
        this.abortController = new AbortController();
        
        // Get model client
        const { providerClient, model } = getChatModelClient({
          settings,
          modelId: settings.chatModelId,
        });
        
        // Generate completion
        const response = await providerClient.generateCompletion({
          model,
          prompt: text,
          signal: this.abortController.signal,
          maxTokens: settings.editorAutocomplete.maxTokens,
          temperature: settings.editorAutocomplete.temperature,
          stopSequences: ['\n']
        });
        
        if (response && response.completion) {
          this.currentSuggestion = response.completion;
          
          // Show suggestion at cursor position
          const position = this.getCursorPosition();
          if (position) {
            this.showGhostElement(response.completion, position);
          }
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Error generating autocomplete:', error);
        }
        this.hideGhostElement();
        this.currentSuggestion = null;
      } finally {
        this.isGenerating = false;
      }
    }

    // Accept the current suggestion
    private acceptSuggestion() {
      if (!this.currentSuggestion) return;
      
      const { view } = this;
      const selection = view.state.selection.main;
      
      if (selection.empty) {
        // Create a transaction that inserts text and moves cursor to end
        const insertTr = view.state.update({
          changes: {
            from: selection.head,
            to: selection.head,
            insert: this.currentSuggestion
          },
          // Move the selection to the end of the inserted text
          selection: { 
            anchor: selection.head + this.currentSuggestion.length,
            head: selection.head + this.currentSuggestion.length
          }
        });
        
        // Dispatch the transaction
        view.dispatch(insertTr);
        
        // Clear the suggestion
        this.hideGhostElement();
        this.currentSuggestion = null;
      }
    }

    update(update: ViewUpdate) {
      // If the view was updated (text changed, selection changed, etc.)
      if (update.docChanged || update.selectionSet) {
        // If there's a current suggestion, hide it
        if (this.currentSuggestion) {
          this.hideGhostElement();
          this.currentSuggestion = null;
        }
        
        // Clear any pending completion timeout
        if (this.completionTimeout) {
          window.clearTimeout(this.completionTimeout);
        }
        
        // Schedule a new completion check using settings for debounce time
        this.completionTimeout = window.setTimeout(() => {
          const text = this.getTextBeforeCursor();
          
          // Get minChars from settings
          const minChars = settings.editorAutocomplete.minChars;
          
          // TODO: Add proper test trigger for debugging
          if (text.includes('test.')) {
            this.currentSuggestion = ' This is a test completion!';
            const position = this.getCursorPosition();
            if (position) {
              this.showGhostElement(this.currentSuggestion, position);
            }
            return;
          }
          
          if (text.trim().length >= minChars) {
            this.generateCompletion(text);
          }
        }, settings.editorAutocomplete.debounceMs); // Use debounce time from settings
      }
    }

    destroy() {
      // Clean up
      if (this.completionTimeout) {
        window.clearTimeout(this.completionTimeout);
      }
      
      if (this.abortController) {
        this.abortController.abort();
      }
      
      if (this.ghostElement && this.ghostElement.parentNode) {
        this.ghostElement.parentNode.removeChild(this.ghostElement);
      }
    }
  });
};

// Setup keyboard event handlers for the editor
export function setupEditorKeybindings(
  plugin: Plugin, 
  settings: SmartComposerSettings
) {
  // Register global event listener for keyboard events
  const keyDownListener = (event: KeyboardEvent) => {
    // Need to check if we're in an editor view
    const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) return;
    
    const editor = activeView.editor;
    if (!editor) return;
    
    // Find the ghost element
    const ghostElement = document.querySelector('.smtcmp-autocomplete-ghost-text') as HTMLElement | null;
    if (!ghostElement || ghostElement.style.display === 'none') return;
    
    // Suggestion text
    const ghostText = ghostElement.querySelector('.smtcmp-autocomplete-ghost-cursor')?.textContent;
    if (!ghostText) return;
    
    // Handle Tab key to accept suggestion
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      
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
    }
    
    // Handle Escape key to dismiss suggestion
    if (event.key === 'Escape') {
      // Hide the ghost element
      ghostElement.style.display = 'none';
    }
  };
  
  // Register the event listener
  document.addEventListener('keydown', keyDownListener);
  
  // Return a cleanup function
  return () => {
    document.removeEventListener('keydown', keyDownListener);
  };
}

// Main entry point for setting up autocomplete
export function setupEditorAutocomplete(
  plugin: Plugin, 
  settings: SmartComposerSettings
) {
  // Register the CodeMirror extension
  const extension = autocompleteEditorPlugin(plugin, settings);
  
  // Obsidian uses CodeMirror 6, so we need to register it as an editor extension
  // @ts-ignore - Obsidian's typing is incomplete
  plugin.registerEditorExtension([extension]);
  
  // Setup keyboard bindings
  const cleanupKeybindings = setupEditorKeybindings(plugin, settings);
  
  // Add debug commands for troubleshooting
  addDebugCommands(plugin);
  
  // Return a cleanup function
  return () => {
    cleanupKeybindings();
  };
}

// Debug helper for testing
function addDebugCommands(plugin: Plugin) {
  // Command to test ghost text positioning
  plugin.addCommand({
    id: 'test-autocomplete-ghost-text',
    name: 'Test Autocomplete Ghost Text',
    editorCallback: (editor) => {
      // Create a test ghost element
      const ghostElement = document.querySelector('.smtcmp-autocomplete-ghost-text') as HTMLElement | null;
      
      if (!ghostElement) {
        console.error('No ghost element found. Make sure autocomplete is enabled.');
        return;
      }
      
      // Get cursor position from Obsidian editor
      const cursor = editor.getCursor();
      
      // Use document's getBoundingClientRect on the editor's cursor element
      // This is a workaround since Obsidian's Editor type doesn't expose cursorCoords
      const activeLeaf = plugin.app.workspace.activeLeaf;
      if (!activeLeaf) return;
      
      const view = activeLeaf.view as any;
      const cmEditor = view.editor?.cm || view.sourceMode?.cmEditor;
      
      if (!cmEditor) {
        console.error('Could not find CodeMirror editor');
        return;
      }
      
      // Use native CM6 cursor position
      const editorView = cmEditor.cm as EditorView;
      const pos = editorView.coordsAtPos(editorView.state.selection.main.head);
      
      if (!pos) {
        console.error('Could not determine cursor position');
        return;
      }
      
      // Show ghost text with test content
      const ghostCursor = ghostElement.querySelector('.smtcmp-autocomplete-ghost-cursor') as HTMLElement;
      if (ghostCursor) {
        ghostCursor.textContent = ' DEBUG TEXT FOR TESTING';
      }
      
      // Position and show ghost element
      ghostElement.style.position = 'fixed';
      ghostElement.style.top = `${pos.top}px`;
      ghostElement.style.left = `${pos.right}px`;
      ghostElement.style.display = 'block';
      
      // Apply editor styles
      const cmContent = document.querySelector('.cm-content');
      if (cmContent) {
        const computedStyle = window.getComputedStyle(cmContent);
        ghostElement.style.fontFamily = computedStyle.fontFamily;
        ghostElement.style.fontSize = computedStyle.fontSize;
        ghostElement.style.lineHeight = computedStyle.lineHeight;
      }
      
      console.log('Ghost text test activated. Press Tab to accept or Escape to dismiss.');
    }
  });
  
  // Test LLM completion functionality
  plugin.addCommand({
    id: 'test-autocomplete-llm',
    name: 'Test Autocomplete LLM Provider',
    editorCallback: async (editor) => {
      try {
        const settings = (plugin as any).settings;
        if (!settings) {
          new Notice('Plugin settings not found');
          return;
        }
        
        // Get the currently selected model
        const { providerClient, model } = getChatModelClient({
          settings,
          modelId: settings.chatModelId,
        });
        
        // Get current text
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);
        const textUpToCursor = line.substring(0, cursor.ch);
        
        new Notice('Testing completion with model: ' + model.id);
        
        // Generate a completion
        const response = await providerClient.generateCompletion({
          model,
          prompt: textUpToCursor,
          maxTokens: 50,
          temperature: 0.2,
          stopSequences: ['\n']
        });
        
        if (response && response.completion) {
          // Create a ghost element if it doesn't exist
          let ghostElement = document.querySelector('.smtcmp-autocomplete-ghost-text') as HTMLElement | null;
          
          if (!ghostElement) {
            ghostElement = document.createElement('div');
            ghostElement.className = 'smtcmp-autocomplete-ghost-text';
            
            const cursorElement = document.createElement('span');
            cursorElement.className = 'smtcmp-autocomplete-ghost-cursor';
            ghostElement.appendChild(cursorElement);
            
            document.body.appendChild(ghostElement);
          }
          
          // Get position using CodeMirror
          const activeLeaf = plugin.app.workspace.activeLeaf;
          if (!activeLeaf) return;
          
          const view = activeLeaf.view as any;
          const cmEditor = view.editor?.cm || view.sourceMode?.cmEditor;
          
          if (!cmEditor) {
            console.error('Could not find CodeMirror editor');
            return;
          }
          
          // Use native CM6 cursor position
          const editorView = cmEditor.cm as EditorView;
          const pos = editorView.coordsAtPos(editorView.state.selection.main.head);
          
          if (!pos) {
            console.error('Could not determine cursor position');
            return;
          }
          
          // Show generated text
          const ghostCursor = ghostElement.querySelector('.smtcmp-autocomplete-ghost-cursor') as HTMLElement;
          if (ghostCursor) {
            ghostCursor.textContent = response.completion;
          }
          
          // Position and show ghost element
          ghostElement.style.position = 'fixed';
          ghostElement.style.top = `${pos.top}px`;
          ghostElement.style.left = `${pos.right}px`;
          ghostElement.style.display = 'block';
          
          // Apply editor styles
          const cmContent = document.querySelector('.cm-content');
          if (cmContent) {
            const computedStyle = window.getComputedStyle(cmContent);
            ghostElement.style.fontFamily = computedStyle.fontFamily;
            ghostElement.style.fontSize = computedStyle.fontSize;
            ghostElement.style.lineHeight = computedStyle.lineHeight;
          }
          
          new Notice('Completion generated. Press Tab to accept or Escape to dismiss.', 3000);
        } else {
          new Notice('No completion generated');
        }
      } catch (error) {
        console.error('Error testing LLM completion:', error);
        new Notice('Error testing LLM completion: ' + (error.message || String(error)));
      }
    }
  });
} 