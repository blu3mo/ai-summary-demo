import { GoogleGenerativeAI } from '@google/generative-ai';
import { IComment } from '../models/comment';
import { StanceAnalysis, IStanceAnalysis } from '../models/stanceAnalysis';
import mongoose from 'mongoose';

export interface StanceAnalysisResult {
  question: string;
  stanceAnalysis: {
    [key: string]: {
      count: number;
      comments: string[];
    };
  };
  analysis: string;
}

export class StanceReportGenerator {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
  }

  private async generateAnalysisPrompt(
    questionText: string,
    stanceAnalysis: Map<string, { count: number; comments: string[] }>,
    stanceNames: Map<string, string>
  ): Promise<string> {
    return `以下の論点に対する様々な立場とそれぞれの意見を読み、各立場の意見の傾向、主張の根拠、そして立場間の関係性について分析し、
    その内容を万人に伝わるように徹底的に分かりやすく、かつ十分に専門的で具体的になるように丁寧に説明してください。

  論点: ${questionText}

  ${Array.from(stanceAnalysis.entries()).filter(([_, data]) => data.count > 0).map(([stanceId, data]) => {
    const stanceName = stanceNames.get(stanceId) || 'Unknown';
    return `
  立場: ${stanceName}
  コメント数: ${data.count}
  コメント内容:
  ${data.comments.join('\n')}
  `;
  }).join('\n')}

  分析のポイント:
  - 各立場の主張の要点
  - 異なる立場間の対立点や共通点
  - 特徴的な意見や興味深い視点

  コツ:
  - Markdown記法の見出し、箇条書き、太字などを積極的に利用し、徹底的に読みやすくしてください。
  - パッと読んで誰でも理解できるように簡潔にまとめてください。
  `;
  }

  async getAnalysis(
    projectId: string,
    questionId: string
  ): Promise<IStanceAnalysis | null> {
    const analysis = await StanceAnalysis.findOne({
      projectId: new mongoose.Types.ObjectId(projectId),
      questionId
    }).lean();

    if (analysis) {
      // MongoDBのMapをプレーンなオブジェクトに変換
      const plainStanceAnalysis: {
        [key: string]: {
          count: number;
          comments: string[];
        };
      } = {};
      for (const [key, value] of Object.entries(analysis.stanceAnalysis)) {
        plainStanceAnalysis[key] = {
          count: Number(value.count),  // 確実に数値型に変換
          comments: value.comments
        };
      }
      return {
        ...analysis,
        stanceAnalysis: plainStanceAnalysis
      };
    }
    return null;
  }

  async analyzeStances(
    projectId: string,
    questionText: string,
    comments: IComment[],
    stances: { id: string; name: string }[],
    questionId: string,
    forceRegenerate: boolean = false
  ): Promise<StanceAnalysisResult> {
    // 既存の分析結果を確認（強制再生成でない場合のみ）
    if (!forceRegenerate) {
      const existingAnalysis = await this.getAnalysis(projectId, questionId);
      if (existingAnalysis) {
        console.log('Using existing analysis:', JSON.stringify(existingAnalysis, null, 2));
        console.log('Existing stanceAnalysis:', JSON.stringify(existingAnalysis.stanceAnalysis, null, 2));
        const result = {
          question: questionText,
          stanceAnalysis: existingAnalysis.stanceAnalysis,
          analysis: existingAnalysis.analysis
        };
        console.log('Returning existing analysis result:', JSON.stringify(result, null, 2));
        return result;
      }
    }

    // 立場ごとのコメントを集計
    const stanceAnalysis = new Map<string, { count: number; comments: string[] }>();
    const stanceNames = new Map(stances.map(s => [s.id, s.name]));
    
    // 初期化
    stances.forEach(stance => {
      stanceAnalysis.set(stance.id, { count: 0, comments: [] });
    });

    // コメントを分類
    comments.forEach(comment => {
      const stance = comment.stances?.find(s => s.questionId === questionId);
      if (stance && comment.extractedContent) {
        const analysis = stanceAnalysis.get(stance.stanceId);
        if (analysis) {
          analysis.count++;
          analysis.comments.push(comment.extractedContent);
        }
      }
    });

    try {
      // Geminiによる分析
      const prompt = await this.generateAnalysisPrompt(questionText, stanceAnalysis, stanceNames);
      const result = await this.model.generateContent(prompt);
      const analysis = result.response.text();

      // 分析結果をデータベースに保存
      const stanceAnalysisDoc = new StanceAnalysis({
        projectId: new mongoose.Types.ObjectId(projectId),
        questionId,
        analysis,
        stanceAnalysis: Object.fromEntries(stanceAnalysis),
      });
      await stanceAnalysisDoc.save();

      return {
        question: questionText,
        stanceAnalysis: Object.fromEntries(stanceAnalysis),
        analysis
      };
    } catch (error) {
      console.error('Analysis generation failed:', error);
      throw error;
    }
  }
}