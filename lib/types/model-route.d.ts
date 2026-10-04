export interface ModelRoute {
    provider: string;
    model: string;
}
interface Catalog {
    listProviders: () => {
        id: string;
        name: string;
    }[];
    listModels: (provider: string) => Promise<readonly {
        id: string;
    }[]>;
}
/** 官方目录是默认路由的唯一来源；不猜测模型或切换已有有效选择。 */
export declare function resolveMemoryRoute(catalog: Catalog, stored: ModelRoute, apiConfigured: () => Promise<boolean>): Promise<ModelRoute>;
export {};
