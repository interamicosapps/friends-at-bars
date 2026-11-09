export type RankedGameType = "switch-search" | "ride-the-bus" | "boozed";

export type RankedDailyScoreRow = {
  id: string;
  user_id: string;
  game_type: RankedGameType;
  play_date: string;
  venue_name: string;
  words_found: number | null;
  time_left: number | null;
  drink_count: number | null;
  completed: boolean | null;
  score_points: number | null;
  finished_at: string;
};

export type RankedLeaderboardEntry = RankedDailyScoreRow & {
  rank: number;
};

export type SwitchSearchRankedSubmit = {
  gameType: "switch-search";
  venueName: string;
  wordsFound: number;
  timeLeft: number;
};

export type RideTheBusRankedSubmit = {
  gameType: "ride-the-bus";
  venueName: string;
  drinkCount: number;
  completed: boolean;
};

export type RankedSubmitPayload = SwitchSearchRankedSubmit | RideTheBusRankedSubmit;
