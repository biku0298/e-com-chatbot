export type HistoryMessage = {
  sender: 'user' | 'bot';
  text: string;
};

export type Filters = {
  category?: string | null;
  gender?: string | null;
  maxPrice?: number | null;
  ageMin?: number | null;
  ageMax?: number | null;
  occasion?: string | null;
  color?: string | null;
};

export type Intent = 'product' | 'policy' | 'general' | 'sizing';

export type SizingResult =
  | { action: 'ask'; reply: string }
  | { action: 'recommend'; reply: string; ageMin: number; ageMax: number; gender: string | null };

export type ProductSearchResult = {
  id: number;
  name: string;
  price: number;
  imageUrl: string;
  color: string;
  size: string;
  gender?: string;
  type?: string;
  occasion?: string;
};

export type PolicyChunkSearchResult = {
  heading: string | null;
  content: string;
};
