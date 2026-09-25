import { z } from "zod";

export const ComparisonCampaignIdSchema = z.string().trim().min(1).max(128);

const CAMPAIGN_KEY_PREFIX = "campaign:v1:";
const CampaignKeyPartsSchema = z.tuple([z.string(), ComparisonCampaignIdSchema]);

export const scopeComparisonCampaign = (sourceKey: string, campaignId?: string): string => {
  if (campaignId === undefined) return sourceKey;
  // 旧キーは figma: / local: で始まる。別の名前空間と配列のエンコードで、
  // パスやキャンペーン名に区切り文字が含まれても別の対象と衝突させない。
  const parts = CampaignKeyPartsSchema.parse([sourceKey, campaignId]);
  return `${CAMPAIGN_KEY_PREFIX}${JSON.stringify(parts)}`;
};

export const parseComparisonCampaignKey = (
  sourceKey: string,
): { sourceKey: string; campaignId?: string } => {
  if (!sourceKey.startsWith(CAMPAIGN_KEY_PREFIX)) return { sourceKey };
  try {
    const parts = CampaignKeyPartsSchema.parse(
      JSON.parse(sourceKey.slice(CAMPAIGN_KEY_PREFIX.length)),
    );
    return { sourceKey: parts[0], campaignId: parts[1] };
  } catch {
    throw new Error("Invalid stored comparison campaign key");
  }
};
