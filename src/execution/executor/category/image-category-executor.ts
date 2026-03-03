import { ExecutableJob, ExecutableJobResult } from '../../types';
import { CategoryExecutor } from './category-executor';
import { JobCategory, ImageJobContext, isImageJobContext } from '../../../shared';
import { promises as fs } from 'fs';
import { join, dirname, extname, basename } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { ArtifactMetadata } from '../../../shared';

/**
 * Image Category Executor
 * Handles image processing jobs (resize, crop, grayscale, contrast, upscale)
 */
export class ImageCategoryExecutor implements CategoryExecutor {
  constructor(
    private baseUrl?: string,
    private deviceId?: string,
    private workerId?: string
  ) {}

  async executePlan(job: ExecutableJob): Promise<ExecutableJobResult> {
    // Image jobs are direct execution jobs, no planning needed
    return {
      status: 'success',
      answer: 'Image processing job ready for execution'
    };
  }

  async executeExecution(job: ExecutableJob): Promise<ExecutableJobResult> {
    if (!isImageJobContext(job.context)) {
      throw new Error('Image job context is required for image jobs');
    }

    const imageContext: ImageJobContext = job.context;

    try {
      // Validate required fields
      if (!imageContext.image || !imageContext.image.data) {
        return {
          status: 'failed',
          answer: 'Image processing failed: No image data provided'

        };
      }

      if (!imageContext.operation) {
        return {
          status: 'failed',
          answer: 'Image processing failed: No operation specified'

        };
      }

      // Validate overlay image for merge operation
      if (imageContext.operation === 'merge') {
        if (!imageContext.overlayImage || !imageContext.overlayImage.data) {
          return {
            status: 'failed',
            answer: 'Image processing failed: Overlay image is required for merge operation'

          };
        }
        if (!imageContext.parameters?.width || !imageContext.parameters?.height) {
          return {
            status: 'failed',
            answer: 'Image processing failed: Width and height are required for merge operation'

          };
        }
      }

      // Create temporary directory for image processing
      const tempDir = join(process.cwd(), 'temp-images', job.id);
      if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true });
      }

      // Decode base64 image and save to temp file
      const imageBuffer = Buffer.from(imageContext.image.data, 'base64');
      const inputFileName = imageContext.image.fileName || 'input.png';
      const inputPath = join(tempDir, inputFileName);
      await fs.writeFile(inputPath, imageBuffer);

      // Decode overlay image if present (for merge operation)
      let overlayPath: string | undefined;
      if (imageContext.operation === 'merge' && imageContext.overlayImage) {
        const overlayBuffer = Buffer.from(imageContext.overlayImage.data, 'base64');
        const overlayFileName = imageContext.overlayImage.fileName || 'overlay.png';
        overlayPath = join(tempDir, overlayFileName);
        await fs.writeFile(overlayPath, overlayBuffer);
      }

      // Process the image based on operation
      const outputPath = await this.processImage(
        imageContext.operation,
        inputPath,
        tempDir,
        imageContext.parameters,
        overlayPath
      );

      // Read the processed image (it's already saved by processImage)
      const outputBuffer = await fs.readFile(outputPath);
      const outputFileName = basename(outputPath);

      // Create artifact metadata
      const artifact: ArtifactMetadata = {
        fileName: outputFileName,
        filePath: outputPath,
        workerId: this.workerId || 'unknown',
        fileSize: outputBuffer.length,
        mimeType: imageContext.image.mimeType || 'image/png',
        createdAt: new Date().toISOString()
      };

      // Clean up input files
      try {
        await fs.unlink(inputPath);
        if (overlayPath && existsSync(overlayPath)) {
          await fs.unlink(overlayPath);
        }
      } catch (error) {
        // Ignore cleanup errors
      }

      return {
        status: 'success',
        answer: `Image ${imageContext.operation} operation completed successfully. Output: ${outputFileName}`,
        artifacts: [artifact]
      };

    } catch (error) {
      return {
        status: 'failed',
        answer: `Image processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`

      };
    }
  }

  async executeReview(job: ExecutableJob, childAnswers: Map<string, string>): Promise<ExecutableJobResult> {
    // Image jobs don't need review, just mark as complete
    return {
      status: 'success',
      answer: 'Image processing review completed'
    };
  }

  /**
   * Process image based on operation type
   */
  private async processImage(
    operation: string,
    inputPath: string,
    outputDir: string,
    parameters?: ImageJobContext['parameters'],
    overlayPath?: string
  ): Promise<string> {
    const sharp = require('sharp');
    const outputFileName = `output_${Date.now()}.png`;
    const outputPath = join(outputDir, outputFileName);

    // Ensure output directory exists
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    let pipeline = sharp(inputPath);

    switch (operation) {
      case 'resize':
      case 'upscale':
        if (!parameters || (!parameters.width && !parameters.height)) {
          throw new Error('Width or height required for resize/upscale operation');
        }
        const resizeOptions: any = {};
        if (parameters.width) resizeOptions.width = parameters.width;
        if (parameters.height) resizeOptions.height = parameters.height;
        resizeOptions.fit = parameters.fit || 'cover';
        pipeline = pipeline.resize(resizeOptions);
        break;

      case 'crop':
        if (!parameters || parameters.width === undefined || parameters.height === undefined) {
          throw new Error('Width and height required for crop operation');
        }
        pipeline = pipeline.extract({
          left: parameters.x || 0,
          top: parameters.y || 0,
          width: parameters.width,
          height: parameters.height
        });
        break;

      case 'grayscale':
        pipeline = pipeline.greyscale();
        break;

      case 'adjust_contrast':
        if (parameters?.contrast === undefined) {
          throw new Error('Contrast value required for adjust_contrast operation');
        }
        // Sharp's modulate function for contrast
        // Contrast is typically done via linear transformation
        // Map -100 to 100 to a suitable linear transformation
        const contrastValue = parameters.contrast;
        if (contrastValue !== 0) {
          // Use linear transformation: output = (input - 128) * factor + 128
          // Factor of 1.0 = no change, > 1.0 = more contrast, < 1.0 = less contrast
          const factor = 1 + (contrastValue / 100);
          pipeline = pipeline.linear(factor, 128 * (1 - factor));
        }
        break;

      case 'merge':
        if (!overlayPath) {
          throw new Error('Overlay image path required for merge operation');
        }
        if (!parameters || parameters.width === undefined || parameters.height === undefined) {
          throw new Error('Width and height required for merge operation');
        }
        // Resize overlay image to specified dimensions
        const overlayResized = sharp(overlayPath)
          .resize(parameters.width, parameters.height);

        // Composite the overlay onto the base image at the specified position
        const x = parameters.x || 0;
        const y = parameters.y || 0;
        pipeline = pipeline.composite([
          {
            input: await overlayResized.toBuffer(),
            left: x,
            top: y
          }
        ]);
        break;

      default:
        throw new Error(`Unknown image operation: ${operation}`);
    }

    // Apply format if specified
    if (parameters?.format) {
      const quality = parameters.quality || 80;
      if (parameters.format === 'jpeg') {
        pipeline = pipeline.jpeg({ quality });
      } else if (parameters.format === 'png') {
        pipeline = pipeline.png();
      } else if (parameters.format === 'webp') {
        pipeline = pipeline.webp({ quality });
      } else if (parameters.format === 'avif') {
        pipeline = pipeline.avif({ quality });
      }
    } else {
      // Preserve original format
      const metadata = await sharp(inputPath).metadata();
      if (metadata.format === 'jpeg') {
        pipeline = pipeline.jpeg({ quality: parameters?.quality || 80 });
      } else if (metadata.format === 'webp') {
        pipeline = pipeline.webp({ quality: parameters?.quality || 80 });
      }
    }

    // Save the processed image
    await pipeline.toFile(outputPath);

    return outputPath;
  }
}
