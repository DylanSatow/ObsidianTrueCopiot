import { BaseLLMProvider, CompletionRequest, CompletionResponse } from '../base';
import { defaultGenerateCompletion } from '../completion';
import { ChatModel } from '../../../types/chat-model.types';
import { LLMOptions, LLMRequestNonStreaming, RequestMessage } from '../../../types/llm/request';
import { LLMResponseNonStreaming } from '../../../types/llm/response';

/**
 * Adds the generateCompletion method to a provider class.
 * 
 * This utility function creates a standard implementation of generateCompletion
 * that works with any provider that has a working generateResponse method.
 * 
 * @param providerClass The provider class to extend
 * @param providerType The type name of the provider (e.g., 'groq', 'openrouter')
 */
export function addCompletionToProvider<T extends BaseLLMProvider<any>>(
  providerClass: any, 
  providerType: string
): void {
  if (!providerClass.prototype.generateCompletion) {
    providerClass.prototype.generateCompletion = async function(
      request: CompletionRequest
    ): Promise<CompletionResponse> {
      if (request.model.providerType !== providerType) {
        throw new Error(`Model is not a ${providerType} model`);
      }
      
      return defaultGenerateCompletion(request, async (messages: RequestMessage[]) => {
        // Create a request with parameters that are supported by LLMRequestNonStreaming
        const llmRequest: LLMRequestNonStreaming = {
          messages,
          model: request.model.model,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
        };
        
        const response: LLMResponseNonStreaming = await this.generateResponse(
          request.model,
          llmRequest,
          { signal: request.signal }
        );
        
        const content = response.choices[0].message.content || '';
        return { content };
      });
    };
  }
} 