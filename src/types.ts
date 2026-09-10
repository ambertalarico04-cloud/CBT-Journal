export interface HabitConfigItem {
  key: string;
  label: string;
  max: number;
  hidden?: boolean;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  theme?: 'amoled' | 'light' | 'dusk';
  favoriteFonts?: string[];
  habitGoals?: Record<string, HabitGoal>;
  habitsList?: HabitConfigItem[];
  longTermAnalysis?: LongTermAnalysis;
  createdAt: string;
}

export interface JournalEntry {
  id?: string;
  userId: string;
  date: string; // YYYY-MM-DD
  title: string;
  content: string; // HTML from Tiptap
  mood: string;
  tags: string[];
  images: string[];
  audio: string[];
  analysis?: AIAnalysis;
  createdAt: string;
  updatedAt: string;
}

export interface AIAnalysis {
  moodSummary: string;
  insights: string[];
  advice: string;
  sentimentScore: number;
  tags: string[];
  keyThemes?: string[];
  cognitiveDistortions?: string[];
  underlyingDynamics?: string[];
  cbtReframes?: string[];
  reflectionQuestions?: string[];
  watchPattern?: string;
  safetyNote?: string;
  crisisMessage?: string | null;
}

export interface LongTermAnalysis {
  longTermTrends: string;
  recurringThemes: string[];
  significantShifts: string[];
  overallDisposition: string;
}

export interface Habit {
  id?: string;
  userId: string;
  date: string;
  habitKey: string;
  value: number; // For multi-step (Eat 2x, Water 3x)
}

export interface HabitGoal {
  type: 'weekly' | 'monthly';
  target: number; // number of days
}

export interface Task {
  id?: string;
  userId: string;
  date: string;
  text: string;
  done: boolean;
  importance?: 'low' | 'medium' | 'high' | 'urgent';
  time?: string;
}

export const MOOD_OPTIONS = [
  "In love", "Happy", "Excited", "Peaceful", "Okay", "Tired", "Sad", "Anxious", "Frustrated", "Angry", "Heartbroken"
];

export const MOOD_EMOJIS: Record<string, string> = {
  "In love": "😍",
  "Excited": "🤩",
  "Happy": "😊",
  "Peaceful": "😌",
  "Okay": "🙂",
  "Tired": "😴",
  "Sad": "😢",
  "Anxious": "😰",
  "Frustrated": "😤",
  "Angry": "😡",
  "Heartbroken": "💔"
};

export const getMoodScore = (mood: string): number => {
  if (!mood) return 7;
  const normalized = mood.trim().toLowerCase();
  if (normalized.includes('love')) return 11;
  if (normalized.includes('happ')) return 10;
  if (normalized.includes('excit')) return 9;
  if (normalized.includes('peace')) return 8;
  if (normalized.includes('okay') || normalized === 'meh' || normalized === 'neutral') return 7;
  if (normalized.includes('tire') || normalized.includes('sick')) return 6;
  if (normalized.includes('sad') || normalized.includes('depress') || normalized.includes('melan')) return 5;
  if (normalized.includes('anxi') || normalized.includes('worry')) return 4;
  if (normalized.includes('frust')) return 3;
  if (normalized.includes('angr')) return 2;
  if (normalized.includes('heartbroken') || normalized.includes('broke')) return 1;
  return 7;
};

export const getMoodEmoji = (mood: string): string => {
  if (!mood) return "📝";
  const normalized = mood.trim().toLowerCase();
  if (normalized.includes('love')) return "😍";
  if (normalized.includes('excit')) return "🤩";
  if (normalized.includes('product')) return "💪";
  if (normalized.includes('happ')) return "😊";
  if (normalized.includes('peace')) return "😌";
  if (normalized.includes('okay') || normalized === 'meh') return "🙂";
  if (normalized.includes('tire')) return "😴";
  if (normalized.includes('sick')) return "🤢";
  if (normalized.includes('sad') || normalized.includes('depress') || normalized.includes('melan')) return "😢";
  if (normalized.includes('anxi')) return "😰";
  if (normalized.includes('frust')) return "😤";
  if (normalized.includes('angr')) return "😡";
  if (normalized.includes('heartbroken') || normalized.includes('broke')) return "💔";
  return "📝";
};

export const DEFAULT_HABITS: HabitConfigItem[] = [
  { key: 'make_bed', label: 'Make Bed', max: 1 },
  { key: 'dose', label: 'Dose', max: 1 },
  { key: 'am_skincare', label: 'AM Skincare', max: 1 },
  { key: 'empty_sink', label: 'Empty Sink', max: 1 },
  { key: 'pm_skincare', label: 'PM Skincare', max: 1 },
  { key: 'journal_evening', label: 'Journal (PM)', max: 1 },
  { key: 'take_trash', label: 'Take Trash Out', max: 1 },
  { key: 'eat', label: 'Eat', max: 2 },
  { key: 'water', label: 'Glass of Water', max: 3 },
];

export const HABIT_CONFIG = DEFAULT_HABITS;
