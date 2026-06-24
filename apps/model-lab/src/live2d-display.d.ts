declare module "pixi-live2d-display/cubism4" {
  export enum MotionPriority {
    NONE = 0,
    IDLE = 1,
    NORMAL = 2,
    FORCE = 3
  }

  export class Live2DModel {
    static from(source: string): Promise<Live2DModel>;
    motion(group: string, index?: number, priority?: MotionPriority): Promise<boolean>;
    expression(name: string): Promise<boolean>;
    internalModel?: {
      coreModel?: {
        getParameterValueById?(parameterId: string): number;
        setParameterValueById?(parameterId: string, value: number, weight?: number): void;
      };
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
