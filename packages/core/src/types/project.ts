export interface ProjectModelCameraVector {
  x: number;
  y: number;
  z: number;
}

export interface ProjectModelCameraState {
  position: ProjectModelCameraVector;
  target: ProjectModelCameraVector;
}

export interface ProjectModelSavedCameraPosition {
  id: string;
  label: string;
  state: ProjectModelCameraState;
  createdAt: string;
}

export interface ProjectModelDetails {
  id: string;
  name: string;
  description?: string;
  category?: string;
  tags?: string[];
  model3dId?: string;
  model3dUrl?: string;
  thumbnailId?: string;
  thumbnailUrl?: string;
  isPreset: boolean;
}

export interface ProjectModelEntry {
  id: string;
  projectId: string;
  modelId: string;
  isPrimary: boolean;
  isPreviewPositionLocked: boolean;
  previewCameraState?: ProjectModelCameraState;
  savedCameraPositions?: ProjectModelSavedCameraPosition[];
  displayName?: string;
  model?: ProjectModelDetails;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectPersonalityDetails {
  id: string;
  name: string;
  description: string;
  traits: string[];
  backgroundStory?: string;
  formality: string;
  includeEmojis: boolean;
  responseLength: string;
  exampleConversations: Array<Record<string, unknown>>;
  isPreset: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectPersonalityEntry {
  id: string;
  projectId: string;
  personalityId: string;
  isPrimary: boolean;
  displayName?: string;
  personality: ProjectPersonalityDetails;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectVoiceProfileDetails {
  id: string;
  name: string;
  language: string;
  gender: string;
  mood: string;
  instructionPrompt: string;
  audioFileId?: string;
  audioUrl: string;
  duration: string;
  isPreset: boolean;
  openaiVoice?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectVoiceProfileEntry {
  id: string;
  projectId: string;
  voiceProfileId: string;
  isPrimary: boolean;
  displayName?: string;
  speed: number;
  voiceProfile: ProjectVoiceProfileDetails;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectPreviewData {
  id: string;
  userId?: string;
  name: string;
  description?: string;
  status: string;
  currentStep: string;
  isPublished: boolean;
  isPreset?: boolean;
  thumbnailId?: string;
  thumbnailUrl?: string;
  backgroundType?: string;
  backgroundValue?: string;
  backgroundImageId?: string;
  backgroundImageUrl?: string;
  lightIntensity?: number;
  createdAt: string;
  updatedAt: string;
  models?: ProjectModelEntry[];
  personalities?: ProjectPersonalityEntry[];
  voiceProfiles?: ProjectVoiceProfileEntry[];
}
