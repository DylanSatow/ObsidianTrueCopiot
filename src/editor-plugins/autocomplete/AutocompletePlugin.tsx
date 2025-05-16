import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_NORMAL,
  SELECTION_CHANGE_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_TAB_COMMAND,
  LexicalCommand,
  TextNode,
  createCommand,
} from 'lexical'
import { useCallback, useEffect, useState, useRef } from 'react'

import { useSettings } from '../../../../../contexts/settings-context'
import { getChatModelClient } from '../../../../../core/llm/manager'
import { useDebouncedCallback } from '../../../../../hooks/useDebounce'
import { editorStateToPlainText } from '../../utils/editor-state-to-plain-text'

export const SET_AUTOCOMPLETE_COMMAND: LexicalCommand<string | null> = 
  createCommand('SET_AUTOCOMPLETE_COMMAND')

export const ACCEPT_AUTOCOMPLETE_COMMAND: LexicalCommand<void> =
  createCommand('ACCEPT_AUTOCOMPLETE_COMMAND')

export default function AutocompletePlugin({
  debounceMs = 300,
  minChars = 5,
}: {
  debounceMs?: number
  minChars?: number
}): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const [autocompleteText, setAutocompleteText] = useState<string | null>(null)
  const [currentText, setCurrentText] = useState<string>('')
  const isGeneratingRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const { settings } = useSettings()

  // Function to get current text from the editor
  const getCurrentEditorText = useCallback(() => {
    return editor.getEditorState().read(() => {
      const editorState = editor.getEditorState()
      return editorStateToPlainText(editorState.toJSON())
    })
  }, [editor])

  // Accept the autocomplete suggestion
  const acceptAutocomplete = useCallback(() => {
    if (!autocompleteText) return

    editor.update(() => {
      const selection = $getSelection()
      
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
        return
      }

      const textNode = selection.getNodes()[0]
      if (!$isTextNode(textNode)) return

      const currentOffset = selection.anchor.offset
      
      // Insert the suggested text
      textNode.spliceText(
        currentOffset,
        0,
        autocompleteText,
        undefined
      )

      // Move selection to the end of inserted text
      selection.anchor.offset = currentOffset + autocompleteText.length
      selection.focus.offset = currentOffset + autocompleteText.length

      // Clear autocomplete text
      setAutocompleteText(null)
    })
  }, [editor, autocompleteText])

  // Internal setter that also dispatches the command for external listeners
  const updateAutocompleteText = useCallback((text: string | null) => {
    setAutocompleteText(text)
    // Dispatch the SET_AUTOCOMPLETE_COMMAND for external listeners
    editor.dispatchCommand(SET_AUTOCOMPLETE_COMMAND, text)
  }, [editor])

  // Generate completion based on current text
  const generateCompletion = useDebouncedCallback(async (text: string) => {
    // Don't generate if text is too short
    if (text.trim().length < minChars || isGeneratingRef.current) {
      updateAutocompleteText(null)
      return
    }

    // Test trigger - if the text contains "test.", generate a completion immediately
    if (text.includes("test.")) {
      console.log("Test trigger detected, generating immediate completion")
      updateAutocompleteText(" This is a test completion!")
      return
    }

    try {
      isGeneratingRef.current = true
      
      // Cancel any ongoing requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      
      // Create new abort controller for this request
      abortControllerRef.current = new AbortController()
      
      // Get model client using chat model settings
      const { providerClient, model } = getChatModelClient({
        settings,
        modelId: settings.chatModelId,
      })
      
      // Generate completion
      const response = await providerClient.generateCompletion({
        model,
        prompt: text,
        signal: abortControllerRef.current.signal,
        maxTokens: 50,
        temperature: 0.2,
        stopSequences: ['\n']
      })
      
      if (response && text === getCurrentEditorText().trim()) {
        updateAutocompleteText(response.completion)
      } else {
        updateAutocompleteText(null)
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Error generating autocomplete:', error)
      }
      updateAutocompleteText(null)
    } finally {
      isGeneratingRef.current = false
    }
  }, debounceMs)

  // Check if we should trigger autocomplete based on text changes
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const text = editorStateToPlainText(editorState.toJSON())
        
        if (text !== currentText) {
          setCurrentText(text)
          
          if (text.trim().length >= minChars) {
            generateCompletion(text)
          } else {
            updateAutocompleteText(null)
          }
        }
      })
    })
  }, [editor, generateCompletion, currentText, minChars, updateAutocompleteText])

  // Register command for accepting autocomplete with tab or right arrow
  useEffect(() => {
    const removeTabListener = editor.registerCommand(
      KEY_TAB_COMMAND,
      () => {
        if (autocompleteText) {
          acceptAutocomplete()
          return true
        }
        return false
      },
      COMMAND_PRIORITY_HIGH
    )

    const removeArrowRightListener = editor.registerCommand(
      KEY_ARROW_RIGHT_COMMAND,
      () => {
        // Only handle right arrow at the end of content
        const isAtEnd = editor.getEditorState().read(() => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection)) return false
          
          const node = selection.anchor.getNode()
          return (
            selection.isCollapsed() && 
            selection.anchor.offset === node.getTextContent().length
          )
        })

        if (autocompleteText && isAtEnd) {
          acceptAutocomplete()
          return true
        }
        return false
      },
      COMMAND_PRIORITY_HIGH
    )

    const removeEscapeListener = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        if (autocompleteText) {
          updateAutocompleteText(null)
          return true
        }
        return false
      },
      COMMAND_PRIORITY_HIGH
    )

    const removeSelectionListener = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        // Cancel autocomplete when selection changes
        if (autocompleteText) {
          updateAutocompleteText(null)
        }
        return false
      },
      COMMAND_PRIORITY_LOW
    )

    // Register command to set autocomplete text externally
    const removeSetAutocompleteListener = editor.registerCommand(
      SET_AUTOCOMPLETE_COMMAND,
      (payload: string | null) => {
        setAutocompleteText(payload)
        return true
      },
      COMMAND_PRIORITY_NORMAL
    )

    // Register command to accept autocomplete externally
    const removeAcceptAutocompleteListener = editor.registerCommand(
      ACCEPT_AUTOCOMPLETE_COMMAND,
      () => {
        if (autocompleteText) {
          acceptAutocomplete()
          return true
        }
        return false
      },
      COMMAND_PRIORITY_NORMAL
    )

    // Clean up command listeners
    return () => {
      removeTabListener()
      removeArrowRightListener()
      removeEscapeListener()
      removeSelectionListener()
      removeSetAutocompleteListener()
      removeAcceptAutocompleteListener()
    }
  }, [editor, autocompleteText, acceptAutocomplete, updateAutocompleteText])

  // Effect to expose autocomplete text to parent components
  useEffect(() => {
    // This allows the GhostText component to access the current autocomplete suggestion
    if (autocompleteText) {
      const cursorElement = document.querySelector('.smtcmp-autocomplete-ghost-cursor')
      if (cursorElement) {
        cursorElement.textContent = autocompleteText
      }
    }
  }, [autocompleteText])

  return null
} 