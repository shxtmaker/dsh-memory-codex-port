import { z } from 'zod';
/** 保守证据计量：按 UTF-8 字节计费，覆盖正文、引用和封装。 */
export declare function tokens(text: string): number;
/** 输入与输出均脱敏；不将异常正文写入诊断。 */
export declare function redact(text: string): string;
/** 中文二元组和代码符号精确索引，不依赖英文 FTS 分词。 */
export declare function terms(text: string): string[];
export declare const candidateSchema: z.ZodObject<{
    scope: z.ZodEnum<{
        global: "global";
        project: "project";
    }>;
    kind: z.ZodEnum<{
        preference: "preference";
        decision: "decision";
        experience: "experience";
        skill: "skill";
    }>;
    title: z.ZodString;
    content: z.ZodString;
    status: z.ZodEnum<{
        suggested: "suggested";
        planned: "planned";
        observed: "observed";
        completed: "completed";
        verified: "verified";
        rejected: "rejected";
        expired: "expired";
    }>;
    source_refs: z.ZodArray<z.ZodNumber>;
}, z.core.$strict>;
export declare const extractionSchema: z.ZodObject<{
    raw_memory: z.ZodOptional<z.ZodString>;
    rollout_summary: z.ZodString;
    rollout_slug: z.ZodString;
    items: z.ZodArray<z.ZodObject<{
        scope: z.ZodEnum<{
            global: "global";
            project: "project";
        }>;
        kind: z.ZodEnum<{
            preference: "preference";
            decision: "decision";
            experience: "experience";
            skill: "skill";
        }>;
        title: z.ZodString;
        content: z.ZodString;
        status: z.ZodEnum<{
            suggested: "suggested";
            planned: "planned";
            observed: "observed";
            completed: "completed";
            verified: "verified";
            rejected: "rejected";
            expired: "expired";
        }>;
        source_refs: z.ZodArray<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const proposalSchema: z.ZodObject<{
    changes: z.ZodArray<z.ZodObject<{
        op: z.ZodEnum<{
            update: "update";
            add: "add";
            revoke: "revoke";
        }>;
        id: z.ZodOptional<z.ZodString>;
        revision: z.ZodOptional<z.ZodNumber>;
        title: z.ZodString;
        content: z.ZodString;
        kind: z.ZodEnum<{
            preference: "preference";
            decision: "decision";
            experience: "experience";
            skill: "skill";
        }>;
        status: z.ZodEnum<{
            suggested: "suggested";
            planned: "planned";
            observed: "observed";
            completed: "completed";
            verified: "verified";
            rejected: "rejected";
            expired: "expired";
        }>;
        sources: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type Extraction = z.infer<typeof extractionSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
