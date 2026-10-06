export type HistoryMessage = {
  sender: 'user' | 'bot';
  text: string;
};

export type Filters = {
  category?: string | null;
  type?: string | null;
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

export type ShoppingField =
  | 'category'
  | 'type'
  | 'gender'
  | 'age'
  | 'occasion'
  | 'color'
  | 'maxPrice'
  | 'fit';

export type FieldStatus = 'unknown' | 'known' | 'unimportant';

export type ShoppingState = {
  intent: Intent | null;

  // Requested product information
  category: string | null;
  type: string | null;
  color: string | null;
  fit: string | null;
  occasion: string | null;
  maxPrice: number | null;

  // Known customer / recipient information
  gender: string | null;
  ageMin: number | null;
  ageMax: number | null;

  // Attributes explicitly indicated as not important / does not matter
  unimportantFields: ShoppingField[];

  // Missing information needed before search
  missingFields: ShoppingField[];

  // Search readiness flag
  isReadyForSearch: boolean;
};

export type ShoppingStateUpdate = {
  intent?: Intent | null;
  category?: string | null;
  type?: string | null;
  gender?: string | null;
  ageMin?: number | null;
  ageMax?: number | null;
  age?: number | { min?: number | null; max?: number | null } | null;
  occasion?: string | null;
  color?: string | null;
  maxPrice?: number | string | null;
  fit?: string | null;
  unimportantFields?: ShoppingField[];
};

export type DecisionAction = 'ask' | 'search';

export type ConversationDecision = {
  action: DecisionAction;
  reply: string;
  extractedUpdates: ShoppingStateUpdate;
  updatedState: ShoppingState;
  missingFields: ShoppingField[];
  canSearch: boolean;
  suggestions?: string[];
  reasoning?: string;
};

