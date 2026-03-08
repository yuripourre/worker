import { promises as fs } from 'fs';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { ArtifactMetadata } from '../../shared';

/**
 * Helper class for creating artifacts from job outputs when outputType is 'text' or 'image'
 */
export class OutputArtifactHelper {
  /**
   * Create an artifact file from text output
   * @param jobId The job ID
   * @param textOutput The text output to save
   * @param workerId The worker ID
   * @returns Artifact metadata
   */
  static async createTextArtifact(
    jobId: string,
    textOutput: string,
    workerId: string
  ): Promise<ArtifactMetadata> {
    const tempDir = join(process.cwd(), 'temp-outputs', jobId);
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    const fileName = `output_${Date.now()}.txt`;
    const filePath = join(tempDir, fileName);

    await fs.writeFile(filePath, textOutput, 'utf-8');

    const stats = await fs.stat(filePath);

    return {
      fileName,
      filePath,
      workerId,
      fileSize: stats.size,
      mimeType: 'text/plain',
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Create an artifact file from image data (base64 encoded)
   * @param jobId The job ID
   * @param imageData Base64 encoded image data
   * @param workerId The worker ID
   * @param mimeType The MIME type of the image
   * @returns Artifact metadata
   */
  static async createImageArtifact(
    jobId: string,
    imageData: string,
    workerId: string,
    mimeType: string = 'image/png'
  ): Promise<ArtifactMetadata> {
    const tempDir = join(process.cwd(), 'temp-outputs', jobId);
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    // Determine file extension from MIME type
    const extension = mimeType.split('/')[1] || 'png';
    const fileName = `output_${Date.now()}.${extension}`;
    const filePath = join(tempDir, fileName);

    // Decode base64 and write to file
    const buffer = Buffer.from(imageData, 'base64');
    await fs.writeFile(filePath, buffer);

    const stats = await fs.stat(filePath);

    return {
      fileName,
      filePath,
      workerId,
      fileSize: stats.size,
      mimeType,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Create an in-memory image artifact (no temp file); use with R2 upload flow.
   * @param jobId The job ID (for fileName uniqueness)
   * @param imageData Base64 encoded image data
   * @param workerId The worker ID
   * @param mimeType The MIME type of the image
   * @returns Artifact metadata with inlineData, no filePath
   */
  static createImageArtifactInMemory(
    jobId: string,
    imageData: string,
    workerId: string,
    mimeType: string = 'image/png'
  ): ArtifactMetadata {
    const extension = mimeType.split('/')[1] || 'png';
    const fileName = `output_${Date.now()}.${extension}`;
    const buffer = Buffer.from(imageData, 'base64');
    return {
      fileName,
      workerId,
      fileSize: buffer.length,
      mimeType,
      createdAt: new Date().toISOString(),
      inlineData: imageData,
    };
  }

  /**
   * Extract image data from text output if present
   * Looks for base64 encoded images in the output
   * @param textOutput The text output to search
   * @returns Object with cleanText and imageData (if found)
   */
  static extractImageFromText(textOutput: string): {
    cleanText: string;
    imageData?: string;
    mimeType?: string;
  } {
    // Look for base64 image data in various formats
    const base64Pattern = /data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=]+)/;
    const match = textOutput.match(base64Pattern);

    if (match) {
      const mimeType = `image/${match[1]}`;
      const imageData = match[2];
      const cleanText = textOutput.replace(match[0], '[Image data extracted]').trim();

      return { cleanText, imageData, mimeType };
    }

    // Also check for standalone base64 strings that might be images
    const standaloneBase64 = /^[A-Za-z0-9+/]{100,}={0,2}$/m;
    if (standaloneBase64.test(textOutput) && textOutput.length > 1000) {
      // Likely a base64 image without the data URI prefix
      return {
        cleanText: '[Image data extracted]',
        imageData: textOutput.trim(),
        mimeType: 'image/png', // Default to PNG
      };
    }

    return { cleanText: textOutput };
  }
}

