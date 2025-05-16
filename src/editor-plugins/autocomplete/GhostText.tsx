import { useEffect, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
  SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_LOW,
} from 'lexical'

type GhostTextProps = {
  autocompleteText: string | null
}

export default function GhostText({
  autocompleteText,
}: GhostTextProps): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const [isVisible, setIsVisible] = useState<boolean>(false)

  // Log when we receive autocomplete text for debugging
  useEffect(() => {
    console.log("GhostText received autocomplete:", autocompleteText)
  }, [autocompleteText])

  // Update ghost text position when selection changes
  useEffect(() => {
    const updateGhostTextPosition = () => {
      editor.getEditorState().read(() => {
        const selection = $getSelection()
        
        if (!$isRangeSelection(selection) || !selection.isCollapsed() || !autocompleteText) {
          setIsVisible(false)
          return
        }

        try {
          // Get DOM selection to find cursor position
          const domSelection = window.getSelection()
          
          if (!domSelection || domSelection.rangeCount === 0) {
            setIsVisible(false)
            return
          }

          const range = domSelection.getRangeAt(0)
          const rect = range.getBoundingClientRect()
          
          if (rect) {
            // Position the ghost text at cursor position
            setPosition({
              top: rect.top,
              left: rect.left
            })
            setIsVisible(true)
          } else {
            setIsVisible(false)
          }
        } catch (error) {
          console.error('Error positioning ghost text:', error)
          setIsVisible(false)
        }
      })
    }

    // Update ghost text position when autocomplete text changes
    if (autocompleteText) {
      updateGhostTextPosition()
    } else {
      setIsVisible(false)
    }

    // Register selection change listener to update position
    const removeSelectionListener = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        updateGhostTextPosition()
        return false // Don't prevent default
      },
      COMMAND_PRIORITY_LOW
    )

    return removeSelectionListener
  }, [editor, autocompleteText])

  // If no autocomplete text or position can't be determined, don't render
  if (!autocompleteText || !position || !isVisible) {
    return null
  }

  console.log("Rendering ghost text:", autocompleteText, "at position:", position)

  return (
    <div
      className="smtcmp-autocomplete-ghost-text"
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        pointerEvents: 'none',
        color: 'var(--text-faint)',
        opacity: 0.7,
        whiteSpace: 'pre',
        userSelect: 'none',
        zIndex: 100,
      }}
    >
      <span className="smtcmp-autocomplete-ghost-cursor">{autocompleteText}</span>
    </div>
  )
} 