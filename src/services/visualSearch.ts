import type { CategoryId } from '@/domain/types';

/**
 * Future image-based part identification. Results are *suggestions* that route the customer
 * into normal catalog search; they are never presented as verified fitment.
 */
export type VisualSearchSuggestion = {
  label: string;
  categoryId?: CategoryId;
  partNumberCandidates: string[];
  confidence: number;
};

export interface VisualSearchProvider {
  identify(imageUri: string): Promise<VisualSearchSuggestion[]>;
}
