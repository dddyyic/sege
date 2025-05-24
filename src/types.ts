import { fabric } from "fabric";

export type EditorElementBase<T extends string, P> = {
  readonly id: string;
  fabricObject?: fabric.Object;
  name: string;
  timelineType: string;
  readonly type: T;
  placement: Placement;
  timeFrame: TimeFrame;
  properties: P;
  zIndex?: number; // Layer order for rendering (higher values appear on top)
  trackIndex?: number; // Index of the track in tracksData
  clipIndex?: number; // Index of the clip within the track
  sceneId?: string; //用户做场景分组
  shotIndex?: number; // Index of the shot within the scene
};

export interface ChildTrack {
  elements: EditorElement[];
}

export interface SceneChildTracks {
  voiceover: ChildTrack;
  subtitle: ChildTrack;
  group: ChildTrack;
  [key: string]: ChildTrack; // Allow string indexing for dynamic access
}

export type VideoEditorElement = EditorElementBase<
  "video",
  { src: string; elementId: string; clipId: string; imageObject?: fabric.Image, effect: Effect,trackIndex?:number, isBackground?: boolean }
>;
export type ImageEditorElement = EditorElementBase<
  "image",
  { src: string; elementId: string; clipId: string; imageObject?: fabric.Object, effect: Effect,trackIndex?:number, isBackground?: boolean }
>;

export type AudioEditorElement = EditorElementBase<
  "audio",
  { src: string; elementId: string; clipId: string; volume?: number }
>;
export type TextEditorElement = EditorElementBase<
  "text",
  {
    clipId: string;
    text: string;
    fontSize: number;
    fontWeight: number;
    color?: string;
    textAlign?: string;
    isSubtitle?: boolean;
    outlineColor?: string;
    borderStyle?: number;
    outlineWidth?: number;
    fontFamily?: string;
    textType?: 'subtitle' | 'subheading' | 'heading' | string;
    splittedTexts?: fabric.Text[];
    textObject?: fabric.Text;
  }
>;

export type EditorElement =
  | VideoEditorElement
  | ImageEditorElement
  | AudioEditorElement
  | TextEditorElement
  | SceneEditorElement;

export type SceneEditorElement = EditorElementBase<
  "scene",
  {
    sceneId: string | undefined;
    shotIndex: number;
    clipId: string;
    clipIds: string[];
    renderClipIds: string[];
    elements: EditorElement[];
    childTracks: {
      voiceover: { elements: EditorElement[] },
      subtitle: { elements: EditorElement[] },
      group: { elements: EditorElement[] }
    }
  }
>;

export type Placement = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  alignment?: string;
};

export type TimeFrame = {
  start: number;
  end: number;
};

export type EffectBase<T extends string> = {
  type: T;
}

export type BlackAndWhiteEffect = EffectBase<"none"> | 
EffectBase<"blackAndWhite"> | 
EffectBase<"sepia"> | 
EffectBase<"invert"> |
EffectBase<"saturate"> ;
export type Effect = BlackAndWhiteEffect;
export type EffecType = Effect["type"];

export type AnimationBase<T, P = {}> = {
  id: string;
  targetId: string;
  duration: number;
  type: T;
  properties: P;
}

export type FadeInAnimation = AnimationBase<"fadeIn">;
export type FadeOutAnimation = AnimationBase<"fadeOut">;

export type BreatheAnimation = AnimationBase<"breathe">

export type SlideDirection = "left" | "right" | "top" | "bottom";
export type SlideTextType = 'none'|'character';
export type SlideInAnimation = AnimationBase<"slideIn", {
  direction: SlideDirection,
  useClipPath: boolean,
  textType:'none'|'character'
}>;

export type SlideOutAnimation = AnimationBase<"slideOut", {
  direction: SlideDirection,
  useClipPath: boolean,
  textType:SlideTextType,
}>;

export type Animation =
  FadeInAnimation
  | FadeOutAnimation
  | SlideInAnimation
  | SlideOutAnimation
  | BreatheAnimation;

export type MenuOption =
  | "Video"
  | "Audio"
  | "Text"
  | "Image"
  | "Export"
  | "Animation"
  | "Effect"
  | "Fill";


  // 创建一个默认的场景元素
export const defaultScene: SceneElement = {
    id: 'default-scene',
    name: '默认场景',
    type: 'shot',
    timelineType: 'scene',
    timeFrame: {
      start: 0,
      end: store.maxTime
    },
    childTracks: {
      voiceover: { elements: [] as EditorElement[] },
      subtitle: { elements: [] as EditorElement[] },
      group: { elements: [] as EditorElement[] }
    }
  } as SceneElement;