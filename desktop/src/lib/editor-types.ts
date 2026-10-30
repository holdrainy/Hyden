export type ImageFormat = 'png' | 'webp' | 'jpeg';

export interface EditorTrimRequest {
  inputName: string;
  inputKind: 'audio' | 'video';
  durationSeconds: number;
  startSeconds: number;
  endSeconds: number;
  audioOnly: boolean;
}

export interface FFmpegPlan {
  program: 'ffmpeg';
  args: string[];
  displayCommand: string;
  outputName: string;
  mode: 'plan-only';
  notice: string;
}

export interface EditorCapabilities {
  ffmpegExecution: false;
  nativeImageProcessing: false;
  mode: 'browser' | 'native';
  notice: string;
}

export interface NativeImageRequest {
  assetId: string;
  crop: { x: number; y: number; width: number; height: number };
  width: number;
  height: number;
  format: ImageFormat;
  brightness: number;
  contrast: number;
}
