import { ArquitectureAnalysisImpl } from "../adapters/Impl/arquitectureAnalysisImpl";
import { BasicAnalysisImpl } from "../adapters/Impl/basicAnalysisImpl";
import { ComponentAnalysisImpl } from "../adapters/Impl/componentAnalysis";
import { FunctionalResumeImpl } from "../adapters/Impl/functionalResume";
import { GetSourceImpl } from "../adapters/Impl/getSourceImpl";

export default class AnalysisFactory {
    private jobId: string;
    private jobType: string;
    constructor(jobId: string, jobType: string) {
        this.jobId = jobId;
        this.jobType = jobType;
    }

    init(): Promise<any> {
        const factory = this.defineFactory();
        if (!factory) {
            return Promise.reject(new Error(`Unknown jobType: ${this.jobType}`));
        }
        return factory.execute(this.jobId);
    }

    private defineFactory() {
        const factory = {
            "getSource": new GetSourceImpl(),
            "basicAnalysis": new BasicAnalysisImpl(),
            "functionalResume": new FunctionalResumeImpl(),
            "componentAnalysis": new ComponentAnalysisImpl(),
            "arquitectureAnalysis": new ArquitectureAnalysisImpl(),
        }

        return factory[this.jobType as keyof typeof factory];
    }
}