import OpenAI, { AzureOpenAI } from 'openai'

import { ChatModel } from '../../types/chat-model.types'
import {
  LLMOptions,
  LLMRequestNonStreaming,
  LLMRequestStreaming,
  RequestMessage,
} from '../../types/llm/request'
import {
  LLMResponseNonStreaming,
  LLMResponseStreaming,
} from '../../types/llm/response'
import { LLMProvider } from '../../types/provider.types'

import { BaseLLMProvider, CompletionRequest, CompletionResponse } from './base'
import { defaultGenerateCompletion } from './completion'
import { OpenAIMessageAdapter } from './openaiMessageAdapter'

export class AzureOpenAIProvider extends BaseLLMProvider<
  Extract<LLMProvider, { type: 'azure-openai' }>
> {
  private adapter: OpenAIMessageAdapter
  private client: OpenAI

  constructor(provider: Extract<LLMProvider, { type: 'azure-openai' }>) {
    super(provider)
    this.adapter = new OpenAIMessageAdapter()
    this.client = new AzureOpenAI({
      apiKey: provider.apiKey ?? '',
      endpoint: provider.baseUrl ?? '',
      apiVersion: provider.additionalSettings.apiVersion,
      deployment: provider.additionalSettings.deployment,
      dangerouslyAllowBrowser: true,
    })
  }

  async generateResponse(
    model: ChatModel,
    request: LLMRequestNonStreaming,
    options?: LLMOptions,
  ): Promise<LLMResponseNonStreaming> {
    if (model.providerType !== 'azure-openai') {
      throw new Error('Model is not an Azure OpenAI model')
    }

    return this.adapter.generateResponse(this.client, request, options)
  }

  async streamResponse(
    model: ChatModel,
    request: LLMRequestStreaming,
    options?: LLMOptions,
  ): Promise<AsyncIterable<LLMResponseStreaming>> {
    if (model.providerType !== 'azure-openai') {
      throw new Error('Model is not an Azure OpenAI model')
    }

    return this.adapter.streamResponse(this.client, request, options)
  }

  async generateCompletion(
    request: CompletionRequest,
  ): Promise<CompletionResponse> {
    if (request.model.providerType !== 'azure-openai') {
      throw new Error('Model is not an Azure OpenAI model')
    }
    
    return defaultGenerateCompletion(request, async (messages: RequestMessage[]) => {
      // Create a request with parameters that are supported by the LLMRequestNonStreaming type
      const llmRequest: LLMRequestNonStreaming = {
        messages,
        model: request.model.model,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
      };
      
      const response = await this.generateResponse(
        request.model,
        llmRequest,
        { signal: request.signal }
      );
      
      const content = response.choices[0].message.content || '';
      return { content };
    });
  }

  async getEmbedding(_model: string, _text: string): Promise<number[]> {
    throw new Error(
      `Provider ${this.provider.id} does not support embeddings. Please use a different provider.`,
    )
  }
}
