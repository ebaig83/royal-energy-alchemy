'use strict';

// ── lib/followup-templates.js ─────────────────────────────────────────────────
// Follow-up template definitions and rotation logic.
// Five templates (A–E) rotate by timepoint to reduce survey fatigue,
// increase engagement, and collect broader research data.

const TEMPLATES = {
  A: {
    name:  'Experience',
    focus: 'Experiential reflection — how the session landed',
    questions: [
      { key: 'feelingToday',  question: 'How are you feeling today — emotionally, physically, and energetically?',           placeholder: 'Describe your overall state right now...' },
      { key: 'whatChanged',   question: 'What has changed since your session? Describe any shifts — big or small.',          placeholder: 'Even subtle changes count...' },
      { key: 'whatStoodOut',  question: 'What stood out most during or after your session?',                                  placeholder: 'A feeling, a realization, a moment...' },
    ],
  },
  B: {
    name:  'Recommendations',
    focus: 'Aftercare and recommendation follow-through',
    questions: [
      { key: 'recommendationsTried',       question: 'Which recommendations from your session did you try?',              placeholder: 'List the practices, techniques, or suggestions you attempted...' },
      { key: 'recommendationsMostHelpful', question: 'Which recommendations were most helpful to you?',                   placeholder: 'What made the biggest difference...' },
      { key: 'recommendationsDifficult',   question: 'Which recommendations were difficult to follow — and why?',         placeholder: 'Be honest — this helps Daron adjust his approach...' },
    ],
  },
  C: {
    name:  'Outcomes',
    focus: 'Measurable outcomes and remaining challenges',
    questions: [
      { key: 'whatImproved',           question: 'What has improved since your session? Be as specific as possible.',    placeholder: 'Symptoms, feelings, relationships, situations...' },
      { key: 'whatRemainsChallenging', question: 'What remains challenging or unresolved?',                               placeholder: 'What still needs attention...' },
      { key: 'supportStillNeeded',     question: 'What kind of support do you still feel you need?',                     placeholder: 'Another session, specific guidance, check-in, energy work...' },
    ],
  },
  D: {
    name:  'Research',
    focus: 'Observational and research data collection',
    questions: [
      { key: 'newSymptoms',           question: 'Have you noticed any new symptoms or physical sensations since your session?',                              placeholder: 'Physical, emotional, perceptual, energetic...' },
      { key: 'newInsights',           question: 'What new insights or realizations have come to you since your session?',                                    placeholder: 'Sudden clarity, spiritual messages, new understanding...' },
      { key: 'environmentalTriggers', question: 'Have you identified any environmental triggers — people, places, or situations that affect your energy?',   placeholder: 'Who or what makes things better or worse...' },
      { key: 'unexpectedExperiences', question: 'Have you had any unexpected or unusual experiences since your session?',                                    placeholder: 'Dreams, coincidences, spiritual experiences, physical reactions...' },
    ],
  },
  E: {
    name:  'Long-Term Tracking',
    focus: 'Long-term progress review and goal setting',
    questions: [
      { key: 'progressSinceLastFollowUp', question: 'Describe your overall progress since your last check-in.',               placeholder: 'How have things shifted over time...' },
      { key: 'setbacksSinceLastFollowUp', question: 'Have you experienced any setbacks since your last check-in? Describe.',  placeholder: 'Anything that felt like a step backward...' },
      { key: 'newGoals',                  question: 'What new goals or intentions have emerged for you?',                      placeholder: 'What do you want to work toward in your next session...' },
    ],
  },
};

// Rotation map: timepoint → eligible template pool
// System picks randomly from the pool to vary the experience each time.
const ROTATION = {
  '24hr':   ['A', 'B'],
  '48hr':   ['B', 'C'],
  '72hr':   ['C', 'D'],
  '1month': ['D', 'E'],
  '1mo':    ['D', 'E'],
  '3month': ['E'],
  '3mo':    ['E'],
};

function pickTemplate(followupType) {
  const pool = ROTATION[followupType] || ['A'];
  return pool[Math.floor(Math.random() * pool.length)];
}

function getTemplate(letter) {
  return TEMPLATES[(letter || '').toUpperCase()] || TEMPLATES.A;
}

module.exports = { TEMPLATES, ROTATION, pickTemplate, getTemplate };
