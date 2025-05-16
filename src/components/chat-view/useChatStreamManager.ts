import { UseMutationResult, useMutation } from '@tanstack/react-query'
import { Notice } from 'obsidian'
import { useCallback, useMemo, useRef } from 'react'

import { useApp } from '../../contexts/app-context'
import { useMcp } from '../../contexts/mcp-context'
import { useSettings } from '../../contexts/settings-context'
import {
  LLMAPIKeyInvalidException,
  LLMAPIKeyNotSetException,
  LLMBaseUrlNotSetException,
} from '../../core/llm/exception'
import { getChatModelClient } from '../../core/llm/manager'
import { ChatAssistantMessage, ChatMessage } from '../../types/chat'
import { ToolCallResponseStatus } from '../../types/tool-call.types'
import { parseTagContents } from '../../utils/chat/parse-tag-content'
import { PromptGenerator } from '../../utils/chat/promptGenerator'
import { ResponseGenerator } from '../../utils/chat/responseGenerator'
import { ErrorModal } from '../modals/ErrorModal'

// Time to wait after a code block is complete before applying (in ms)
const CODE_APPLY_DELAY = 300;
// Minimum time between applying code blocks (in ms)
const CODE_APPLY_DEBOUNCE = 1500;

type UseChatStreamManagerParams = {
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
  autoScrollToBottom: () => void
  promptGenerator: PromptGenerator
  handleApply?: (blockToApply: string, chatMessages: ChatMessage[]) => void
}

export type UseChatStreamManager = {
  abortActiveStreams: () => void
  submitChatMutation: UseMutationResult<
    void,
    Error,
    { chatMessages: ChatMessage[]; conversationId: string }
  >
}

export function useChatStreamManager({
  setChatMessages,
  autoScrollToBottom,
  promptGenerator,
  handleApply,
}: UseChatStreamManagerParams): UseChatStreamManager {
  const app = useApp()
  const { settings } = useSettings()
  const { getMcpManager } = useMcp()

  const activeStreamAbortControllersRef = useRef<AbortController[]>([])

  const abortActiveStreams = useCallback(() => {
    for (const abortController of activeStreamAbortControllersRef.current) {
      abortController.abort()
    }
    activeStreamAbortControllersRef.current = []
  }, [])

  const { providerClient, model } = useMemo(() => {
    return getChatModelClient({
      settings,
      modelId: settings.chatModelId,
    })
  }, [settings])

  const submitChatMutation = useMutation({
    mutationFn: async ({
      chatMessages,
      conversationId,
    }: {
      chatMessages: ChatMessage[]
      conversationId: string
    }) => {
      const lastMessage = chatMessages.at(-1)
      if (!lastMessage) {
        // chatMessages is empty
        return
      }

      abortActiveStreams()
      const abortController = new AbortController()
      activeStreamAbortControllersRef.current.push(abortController)

      let unsubscribeResponseGenerator: (() => void) | undefined
      // Track completion status to auto-apply code when done
      let isComplete = false
      let currentMessages: ChatMessage[] = []
      // Track whether we've applied a code block to avoid duplicate applications
      let appliedCodeBlocks = new Set<string>()
      // Store the last known content to detect when new content is added
      let lastKnownContent = ''
      // Track the last time we applied a code block for debouncing
      let lastApplyTime = 0
      // Timer for delayed application
      let applyTimer: ReturnType<typeof setTimeout> | null = null

      // Function to apply code with debouncing and timing logic
      const applyCodeWithDelay = (codeContent: string, messages: ChatMessage[]) => {
        // Clear any pending apply operation
        if (applyTimer) {
          clearTimeout(applyTimer);
        }
        
        // Schedule the apply after a short delay
        applyTimer = setTimeout(() => {
          // Only if we're not already applying changes too frequently
          const now = Date.now();
          if (now - lastApplyTime >= CODE_APPLY_DEBOUNCE) {
            if (handleApply) {
              handleApply(codeContent, messages);
              lastApplyTime = now;
            }
          }
        }, CODE_APPLY_DELAY);
      };

      try {
        const mcpManager = await getMcpManager()
        const responseGenerator = new ResponseGenerator({
          providerClient,
          model,
          messages: chatMessages,
          conversationId,
          enableTools: settings.chatOptions.enableTools,
          maxAutoIterations: settings.chatOptions.maxAutoIterations,
          promptGenerator,
          mcpManager,
          abortSignal: abortController.signal,
        })

        unsubscribeResponseGenerator = responseGenerator.subscribe(
          (responseMessages) => {
            setChatMessages((prevChatMessages) => {
              const lastMessageIndex = prevChatMessages.findIndex(
                (message) => message.id === lastMessage.id,
              )
              if (lastMessageIndex === -1) {
                // The last message no longer exists in the chat history.
                // This likely means a new message was submitted while this stream was running.
                // Abort this stream and keep the current chat history.
                abortController.abort()
                return prevChatMessages
              }
              
              const updatedMessages = [
                ...prevChatMessages.slice(0, lastMessageIndex + 1),
                ...responseMessages,
              ]
              
              // Save current messages for auto-apply check
              currentMessages = updatedMessages
              
              // Check if there's a complete code block during streaming
              if (handleApply && !isComplete) {
                const lastGeneratedMessage = responseMessages.find(msg => msg.role === 'assistant');
                
                if (lastGeneratedMessage && 
                    lastGeneratedMessage.role === 'assistant' &&
                    lastGeneratedMessage.content) {
                  
                  // Only process if content has changed
                  const currentContent = lastGeneratedMessage.content;
                  if (currentContent !== lastKnownContent) {
                    lastKnownContent = currentContent;
                    
                    // Check if the content has at least one complete code block (has both opening and closing tags)
                    const hasCompleteCodeBlock = 
                      currentContent.includes('<smtcmp_block>') && 
                      currentContent.includes('</smtcmp_block>');
                    
                    if (hasCompleteCodeBlock) {
                      // Parse the content to extract code blocks
                      const blocks = parseTagContents(currentContent);
                      const codeBlocks = blocks.filter(block => block.type === 'smtcmp_block' && block.content);
                      
                      // Find the first complete code block we haven't applied yet
                      const codeBlockToApply = codeBlocks.find(block => 
                        block.content && 
                        block.content.trim() !== '' && 
                        !appliedCodeBlocks.has(block.content)
                      );
                      
                      if (codeBlockToApply && codeBlockToApply.content) {
                        // Only apply if we're not already applying a change and not in the middle of tool calls
                        const isProcessingToolCalls = updatedMessages.some(m => 
                          m.role === 'tool' && m.toolCalls?.some(tc => 
                            tc.response.status === ToolCallResponseStatus.Running || 
                            tc.response.status === ToolCallResponseStatus.PendingApproval
                          )
                        );
                        
                        if (!isProcessingToolCalls) {
                          // Track this code block to avoid applying it again
                          appliedCodeBlocks.add(codeBlockToApply.content);
                          
                          // Apply the code with our timing logic
                          applyCodeWithDelay(codeBlockToApply.content, updatedMessages);
                        }
                      }
                    }
                  }
                }
              }
              
              return updatedMessages
            })
            autoScrollToBottom()
          },
        )

        await responseGenerator.run()
        isComplete = true
        
        // Clean up any pending apply timers
        if (applyTimer) {
          clearTimeout(applyTimer);
        }
        
        // Auto-apply code when generation is complete, but only if we haven't applied the last code block
        if (handleApply && currentMessages.length > 0) {
          const lastGeneratedMessage = currentMessages[currentMessages.length - 1]
          
          // Check if the last message is an assistant message
          if (
            lastGeneratedMessage.role === 'assistant' &&
            !currentMessages.some(m => m.role === 'tool' && m.toolCalls?.some(tc => 
              tc.response.status === ToolCallResponseStatus.Running || 
              tc.response.status === ToolCallResponseStatus.PendingApproval
            ))
          ) {
            const assistantMessage = lastGeneratedMessage as ChatAssistantMessage
            if (assistantMessage.content) {
              // Look for code blocks in the message
              const blocks = parseTagContents(assistantMessage.content)
              const codeBlocks = blocks.filter(block => block.type === 'smtcmp_block' && block.content);
              
              // Get the last code block
              const lastCodeBlock = codeBlocks[codeBlocks.length - 1];
              
              if (lastCodeBlock && 
                  lastCodeBlock.content && 
                  !appliedCodeBlocks.has(lastCodeBlock.content)) {
                // If we have a code block we haven't applied yet, apply it directly
                // No need for delays at the end of generation
                handleApply(lastCodeBlock.content, currentMessages)
              }
            }
          }
        }
      } catch (error) {
        // Ignore AbortError
        if (error instanceof Error && error.name === 'AbortError') {
          return
        }
        throw error
      } finally {
        // Clear any pending timers
        if (applyTimer) {
          clearTimeout(applyTimer);
        }
        
        if (unsubscribeResponseGenerator) {
          unsubscribeResponseGenerator()
        }
        activeStreamAbortControllersRef.current =
          activeStreamAbortControllersRef.current.filter(
            (controller) => controller !== abortController,
          )
      }
    },
    onError: (error) => {
      if (
        error instanceof LLMAPIKeyNotSetException ||
        error instanceof LLMAPIKeyInvalidException ||
        error instanceof LLMBaseUrlNotSetException
      ) {
        new ErrorModal(app, 'Error', error.message, error.rawError?.message, {
          showSettingsButton: true,
        }).open()
      } else {
        new Notice(error.message)
        console.error('Failed to generate response', error)
      }
    },
  })

  return {
    abortActiveStreams,
    submitChatMutation,
  }
}
