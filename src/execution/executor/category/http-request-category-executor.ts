import { ExecutableJob, ExecutableJobResult } from '../../types';
import { CategoryExecutor } from './category-executor';
import { HttpRequestJobContext, isHttpRequestJobContext } from '../../../shared';
import { OutputArtifactHelper } from '../output-artifact-helper';

/**
 * HTTP Request Category Executor.
 * Performs HTTP request jobs.
 */
export class HttpRequestCategoryExecutor implements CategoryExecutor {
  constructor(
    private baseUrl?: string,
    private deviceId?: string,
    private workerId?: string
  ) {}

  async executeExecution(job: ExecutableJob): Promise<ExecutableJobResult> {
    if (!isHttpRequestJobContext(job.context)) {
      throw new Error('HTTP request context is required for HTTP request jobs');
    }

    const httpContext: HttpRequestJobContext = job.context;

    try {
      // Execute the HTTP request
      const result = await this.executeHttpRequest(httpContext);

      const execResult: ExecutableJobResult = {
        status: 'success',
        answer: result.response

      };

      // Check if outputType is 'text' or 'image' and create artifact
      if (httpContext.outputType) {
        const outputType = httpContext.outputType;

        if (outputType === 'text' || outputType === 'image') {
          try {
            if (outputType === 'text') {
              // Save output as text artifact
              const artifact = await OutputArtifactHelper.createTextArtifact(
                job.id,
                result.response,
                this.workerId || 'unknown'
              );
              execResult.artifacts = [artifact];
            } else if (outputType === 'image') {
              // Extract image data from the output if present
              const extracted = OutputArtifactHelper.extractImageFromText(result.response);

              if (extracted.imageData) {
                const artifact = await OutputArtifactHelper.createImageArtifact(
                  job.id,
                  extracted.imageData,
                  this.workerId || 'unknown',
                  extracted.mimeType
                );
                execResult.artifacts = [artifact];
                execResult.answer = extracted.cleanText;
              } else {
                // No image data found, save as text artifact
                const artifact = await OutputArtifactHelper.createTextArtifact(
                  job.id,
                  result.response,
                  this.workerId || 'unknown'
                );
                execResult.artifacts = [artifact];
              }
            }
          } catch (error) {
            console.error(`Failed to create output artifact for job ${job.id}:`, error);
            // Don't fail the job, just log the error
          }
        }
      }

      return execResult;
    } catch (error) {
      return {
        status: 'failed',
        answer: `HTTP request failed: ${error instanceof Error ? error.message : 'Unknown error'}`

      };
    }
  }

  private async executeHttpRequest(context: HttpRequestJobContext): Promise<{response: string}> {
    const { url, method, headers: contextHeaders = {}, body, timeout = 30000, webhook, image } = context;

    const headers: Record<string, string> = { ...contextHeaders };
    const requestOptions: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(timeout),
    };

    // If image is present, use multipart form data
    if (image && ['POST', 'PUT', 'PATCH'].includes(method)) {
      const formData = new FormData();

      // Convert base64 image back to blob
      const imageData = Uint8Array.from(atob(image.data), c => c.charCodeAt(0));
      const imageBlob = new Blob([imageData], { type: image.mimeType });
      formData.append('image', imageBlob, image.fileName);

      // Add body data as form field if present
      if (body) {
        if (typeof body === 'string') {
          try {
            // Try to parse as JSON first
            const parsed = JSON.parse(body);
            // If it's an object, add each field separately
            if (typeof parsed === 'object' && !Array.isArray(parsed)) {
              Object.entries(parsed).forEach(([key, value]) => {
                formData.append(key, String(value));
              });
            } else {
              formData.append('data', body);
            }
          } catch {
            // Not JSON, add as plain text
            formData.append('data', body);
          }
        } else {
          // Body is already an object
          Object.entries(body).forEach(([key, value]) => {
            formData.append(key, String(value));
          });
        }
      }

      requestOptions.body = formData;
      // Don't set Content-Type header when using FormData - browser will set it with boundary
      delete headers['Content-Type'];
    } else {
      // No image, use regular JSON or body
      headers['Content-Type'] = 'application/json';

      // Add body for methods that support it
      if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        if (typeof body === 'string') {
          requestOptions.body = body;
        } else {
          requestOptions.body = JSON.stringify(body);
        }
      }
    }

    try {
      // Make the HTTP request
      const response = await fetch(url, requestOptions);

      // Get response data
      const responseText = await response.text();
      let responseData;

      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = responseText;
      }

      // Prepare response summary
      const responseSummary = {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        data: responseData
      };

      // If webhook is provided, send the response to the webhook
      if (webhook) {
        await this.sendToWebhook(webhook, responseSummary);
        return {
          response: `HTTP request completed successfully. Response sent to webhook: ${webhook}\n\nResponse Details:\n${JSON.stringify(responseSummary, null, 2)}`
        };
      }

      return {
        response: `HTTP request completed successfully.\n\nResponse Details:\n${JSON.stringify(responseSummary, null, 2)}`
      };

    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(`Request timed out after ${timeout}ms`);
        }
        throw new Error(`Request failed: ${error.message}`);
      }
      throw new Error('Request failed with unknown error');
    }
  }

  private async sendToWebhook(webhookUrl: string, data: any): Promise<void> {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          data: data
        })
      });

      if (!response.ok) {
        throw new Error(`Webhook request failed with status ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to send data to webhook:', error);
      throw new Error(`Webhook delivery failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
