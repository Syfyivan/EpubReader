import { Controller, Post, Body } from "@nestjs/common";
import {
  AIService,
  AnalyzeContentDto,
  GenerateCodeDto,
  ExplainCodeDto,
  ReviewCodeDto,
} from "./ai.service";

@Controller("api/ai")
export class AIController {
  constructor(private readonly aiService: AIService) {}

  @Post("analyze")
  async analyzeContent(@Body() dto: AnalyzeContentDto) {
    return await this.aiService.analyzeContent(dto);
  }

  @Post("code/generate")
  async generateCode(@Body() dto: GenerateCodeDto) {
    const code = await this.aiService.generateCode(dto);
    return { code };
  }

  @Post("code/explain")
  async explainCode(@Body() dto: ExplainCodeDto) {
    const explanation = await this.aiService.explainCode(dto);
    return { explanation };
  }

  @Post("code/review")
  async reviewCode(@Body() dto: ReviewCodeDto) {
    const review = await this.aiService.reviewCode(dto);
    return { review };
  }
}
