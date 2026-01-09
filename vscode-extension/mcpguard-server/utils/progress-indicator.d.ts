export type StepStatus = 'pending' | 'running' | 'success' | 'failed';
export interface ExecutionStep {
    name: string;
    status: StepStatus;
}
export declare class ProgressIndicator {
    private steps;
    updateStep(index: number, status: StepStatus): void;
    render(): void;
    clear(): void;
    showFinal(failedAt?: number): void;
    reset(): void;
}
//# sourceMappingURL=progress-indicator.d.ts.map