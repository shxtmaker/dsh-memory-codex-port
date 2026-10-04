import z from '@deepseek-ai/schemastery';
import type { Volatile } from '@deepseek-ai/cordis';
/** 开关通过宿主 ConfigEditor 原子持久化；生产默认不发送历史。 */
export interface Config {
    memoryProfileId: string;
    globalUse: Volatile<boolean>;
    globalGenerate: Volatile<boolean>;
    projectUse: Volatile<boolean>;
    projectGenerate: Volatile<boolean>;
    consent: Volatile<boolean>;
    provider: Volatile<string>;
    model: Volatile<string>;
    idleMinutes: Volatile<number>;
    consolidationMinutes: Volatile<number>;
    outputTokens: Volatile<number>;
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    memoryProfileId: z<string, string, "defined">;
    globalUse: z<boolean, boolean, "volatile-defined">;
    globalGenerate: z<boolean, boolean, "volatile-defined">;
    projectUse: z<boolean, boolean, "volatile-defined">;
    projectGenerate: z<boolean, boolean, "volatile-defined">;
    consent: z<boolean, boolean, "volatile-defined">;
    provider: z<string, string, "volatile-defined">;
    model: z<string, string, "volatile-defined">;
    idleMinutes: z<number, number, "volatile-defined">;
    consolidationMinutes: z<number, number, "volatile-defined">;
    outputTokens: z<number, number, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    memoryProfileId: z<string, string, "defined">;
    globalUse: z<boolean, boolean, "volatile-defined">;
    globalGenerate: z<boolean, boolean, "volatile-defined">;
    projectUse: z<boolean, boolean, "volatile-defined">;
    projectGenerate: z<boolean, boolean, "volatile-defined">;
    consent: z<boolean, boolean, "volatile-defined">;
    provider: z<string, string, "volatile-defined">;
    model: z<string, string, "volatile-defined">;
    idleMinutes: z<number, number, "volatile-defined">;
    consolidationMinutes: z<number, number, "volatile-defined">;
    outputTokens: z<number, number, "volatile-defined">;
}>>, "plain">;
