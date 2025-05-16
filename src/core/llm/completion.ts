import { RequestMessage } from "../../types/llm/request";
import { CompletionRequest, CompletionResponse } from "./base";

/**
 * Default implementation of generateCompletion for LLM providers
 * This uses their existing API capabilities to simulate a completion function
 */
export async function defaultGenerateCompletion(
  request: CompletionRequest,
  generateResponseFn: (messages: RequestMessage[]) => Promise<{ content: string }>
): Promise<CompletionResponse> {
  // Create a system message that instructs the model to complete the text
  const systemMessage: RequestMessage = {
    role: 'system',
    content: 'You are a helpful assistant that completes the user\'s text. Provide ONLY a natural continuation of the text, no explanations or additional commentary. Keep your response concise and focused on continuing the exact text in a natural way. Do NOT use quotation marks or any other formatting.',
  };

  // Create a user message with the prompt
  const userMessage: RequestMessage = {
    role: 'user',
    content: request.prompt,
  };

  // Generate a response using the provider's existing API
  try {
    const response = await generateResponseFn([systemMessage, userMessage]);
    
    // Process the response to ensure it's a good completion
    let completion = response.content.trim();
    
    // Remove any prefixes like quotation marks or assistant:
    completion = completion.replace(/^["']|["']$/g, '');  // Remove quotes
    completion = completion.replace(/^(Assistant:|I would continue this as:)/i, '').trim();
    
    return {
      completion
    };
  } catch (error) {
    console.error('Error in defaultGenerateCompletion:', error);
    throw error;
  }
} 