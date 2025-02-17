import { StancePrompts } from './types';

export const stancePrompts: StancePrompts = {
  stanceAnalysis: (questionText: string, stanceOptions: string, context?: string) => `
以下のコメントに対して、論点「${questionText}」について、コメントがどの立場を取っているか分析してください。立場が明確でなければ「立場なし」を選択してください。

${context ? `背景情報:
"""
${context}
"""

` : ''}コメント:
"""
{content}
"""

可能な立場: "${stanceOptions}"

注意事項:
- "立場なし": コメントが論点に対して明確な立場を示していない場合
- "その他の立場": コメントが論点に対して明確な立場を示しているが、与えられた選択肢のいずれにも当てはまらない場合
- コメントの言外の意味を読み取ろうとせず、明示的に書かれている内容のみを分析してください

以下のJSON形式で回答してください:
{
  "reasoning": "考察"
  "stance": "立場の名前",
  "confidence": 信頼度（0から1の数値）,
}`
};