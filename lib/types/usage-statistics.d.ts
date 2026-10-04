/** 按执行主机的本地自然日结算，日界按日历递增以适应夏令时。 */
export declare function localUsageDay(now?: number): {
    day: string;
    timezone: string;
    start: number;
    end: number;
};
