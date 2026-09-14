export { KhaveeProvider, useKhavee } from "./KhaveeProvider";
export {
  VRMAvatar,
  useVRM,
  useVRMExpressions,
  useVRMAnimations,
  useAnimations,
} from "./VRMAvatar";
export { GLBAvatar } from "./GLBAvatar";
export type { AnimationConfig } from "./VRMAvatar";
export type { AnimationCycleOrder } from "./animation/AnimationStateEngine";
export {
  AvatarPostFX,
  ShadowFloor,
  AvatarContactShadows,
  DEFAULT_LIGHT_RIG,
  repairMToonMaterials,
  snapshotMToon,
  restoreMToon,
  setMToonDebugMode,
  DEFAULT_REPAIR,
  FACE_DETAIL_MATERIAL_RE,
} from "./utils/renderQuality";
export type {
  AvatarPostFXProps,
  AvatarToneMapping,
  DepthOfFieldOptions,
  VignetteOptions,
  GradingOptions,
  ShadowFloorProps,
  AvatarContactShadowsProps,
  LightRigOptions,
  LightSpec,
  LightSetting,
  ShadowOptions,
  MaterialPreset,
  MToonDebugMode,
  RepairOptions,
  RepairResult,
  RepairLogEntry,
  MToonSnapshot,
} from "./utils/renderQuality";
export { AvatarBackdrop } from "./utils/AvatarBackdrop";
export type {
  AvatarBackdropProps,
  AvatarBackground,
  BackgroundFit,
} from "./utils/AvatarBackdrop";
export * from "./hooks";
