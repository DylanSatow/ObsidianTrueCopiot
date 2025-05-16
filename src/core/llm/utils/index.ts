import { addCompletionToProvider } from './completeProviders';
import { AnthropicProvider } from '../anthropic';
import { AzureOpenAIProvider } from '../azureOpenaiProvider';
import { DeepSeekStudioProvider } from '../deepseekStudioProvider';
import { GeminiProvider } from '../gemini';
import { GroqProvider } from '../groq';
import { LmStudioProvider } from '../lmStudioProvider';
import { MistralProvider } from '../mistralProvider';
import { MorphProvider } from '../morphProvider';
import { OllamaProvider } from '../ollama';
import { OpenAICompatibleProvider } from '../openaiCompatibleProvider';
import { OpenRouterProvider } from '../openRouterProvider';
import { PerplexityProvider } from '../perplexityProvider';

/**
 * Initialize all providers by adding generateCompletion methods if they don't have one
 */
export function initializeProviders(): void {
  // Add generateCompletion to each provider
  addCompletionToProvider(GroqProvider, 'groq');
  addCompletionToProvider(LmStudioProvider, 'lm-studio');
  addCompletionToProvider(MistralProvider, 'mistral');
  addCompletionToProvider(OpenAICompatibleProvider, 'openai-compatible');
  addCompletionToProvider(OpenRouterProvider, 'openrouter');
  addCompletionToProvider(OllamaProvider, 'ollama');
  addCompletionToProvider(DeepSeekStudioProvider, 'deepseek');
  addCompletionToProvider(MorphProvider, 'morph');
  addCompletionToProvider(GeminiProvider, 'gemini');
  addCompletionToProvider(PerplexityProvider, 'perplexity');
} 