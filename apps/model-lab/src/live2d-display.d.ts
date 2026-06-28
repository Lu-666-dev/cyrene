declare module "pixi-live2d-display/cubism4" {
  export enum MotionPriority {
    NONE = 0,
    IDLE = 1,
    NORMAL = 2,
    FORCE = 3
  }

  export interface Live2DModelOptions {
    readonly autoInteract?: boolean;
    readonly autoUpdate?: boolean;
  }

  export interface FocusController {
    targetX: number;
    targetY: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
  }

  export interface DrawableBounds {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  export class Live2DModel {
    static from(source: string, options?: Live2DModelOptions): Promise<Live2DModel>;
    motion(group: string, index?: number, priority?: MotionPriority): Promise<boolean>;
    expression(name: string): Promise<boolean>;
    focus(x: number, y: number, instant?: boolean): void;
    internalModel?: {
      coreModel?: {
        getParameterCount?(): number;
        getParameterId?(index: number): string;
        getParameterValueById?(parameterId: string): number;
        setParameterValueById?(parameterId: string, value: number, weight?: number): void;
      };
      focusController?: FocusController;
      getDrawableIDs?(): string[];
      getDrawableBounds?(index: number | string, bounds?: DrawableBounds): DrawableBounds;
      update?(dt: number, now: number): void;
      motionManager?: {
        stopAllMotions(): void;
        expressionManager?: {
          stopAllExpressions?(): void;
        };
      };
    };
    destroy(): void;
    scale: {
      set(value: number): void;
    };
    anchor?: {
      set(x: number, y?: number): void;
    };
    x: number;
    y: number;
    width: number;
    height: number;
  }
}
