'use strict';

// ── lib/followup-processor.js ─────────────────────────────────────────────────
// Post-submission intelligence pipeline for client aftercare responses.
// Extracts structured signals, generates practitioner summary, detects urgency,
// writes processed output to DB for research and knowledge centers.

const URGENCY_PHRASES = ['yes', 'book another', 'need another session', 'please check in',
                         'really struggling', 'getting worse', 'crisis', 'urgent'];

// ── Signal extraction ─────────────────────────────────────────────────────────

function extractSignals(responseData) {
  const r = responseData || {};

  const intensityNum = parseInt(r.intensity) || 5;
  const intensityDir = intensityNum <= 3 ? 'improving'
                     : intensityNum <= 6 ? 'processing'
                     :                     'elevated';

  const sleep = (r.sleep || '').toLowerCase();
  const sleepDir = sleep.includes('better') || sleep.includes('deeper') ? 'improved'
                 : sleep.includes('disturbing') || sleep.includes('nightmare') || sleep.includes('disrupted') ? 'worsened'
                 : 'neutral';

  // Improvements — aggregate from all template variants
  const improvements = [];
  if (r.lighter && r.lighter.length > 5)                               improvements.push(r.lighter);
  if (r.whatImproved && r.whatImproved.length > 5)                     improvements.push(r.whatImproved);
  if (r.breakthroughsExperienced && r.breakthroughsExperienced.length > 5) improvements.push(r.breakthroughsExperienced);
  if (r.feelingToday && r.feelingToday.length > 5)                     improvements.push(r.feelingToday);
  if (r.whatChanged && r.whatChanged.length > 5)                       improvements.push(r.whatChanged);
  const sympImp = Array.isArray(r.symptomsImproved) ? r.symptomsImproved : (r.symptomsImproved ? [r.symptomsImproved] : []);
  sympImp.forEach(s => improvements.push(s));

  // Challenges remaining — aggregate from all template variants
  const challenges = [];
  if (r.stillActive && r.stillActive.length > 5)               challenges.push(r.stillActive);
  if (r.challengesRemaining && r.challengesRemaining.length > 5) challenges.push(r.challengesRemaining);
  if (r.whatRemainsChallenging && r.whatRemainsChallenging.length > 5) challenges.push(r.whatRemainsChallenging);

  // Recommendations followed / ignored
  const recommendationsFollowed = [];
  const recommendationsIgnored  = [];
  const aftercareArr = Array.isArray(r.aftercare) ? r.aftercare : (r.aftercare ? [r.aftercare] : []);
  aftercareArr.filter(a => a !== 'None yet').forEach(a => recommendationsFollowed.push(a));
  if (r.recommendationsTried && r.recommendationsTried.length > 5)       recommendationsFollowed.push(r.recommendationsTried);
  if (r.recommendationsMostHelpful && r.recommendationsMostHelpful.length > 5) recommendationsFollowed.push(r.recommendationsMostHelpful);
  if (r.recommendationsNotFollowed && r.recommendationsNotFollowed.length > 5) recommendationsIgnored.push(r.recommendationsNotFollowed);
  if (r.recommendationsDifficult && r.recommendationsDifficult.length > 5)     recommendationsIgnored.push(r.recommendationsDifficult);

  // Symptoms worsened
  const symptomsWorsened = [];
  const sympW = Array.isArray(r.symptomsWorsened) ? r.symptomsWorsened : (r.symptomsWorsened ? [r.symptomsWorsened] : []);
  sympW.filter(s => s !== 'None').forEach(s => symptomsWorsened.push(s));
  if (r.newSymptoms && r.newSymptoms.length > 5) symptomsWorsened.push(r.newSymptoms);

  // Outcomes (Template C)
  const outcomes = {
    improved:   r.whatImproved || null,
    remaining:  r.whatRemainsChallenging || null,
    support:    r.supportStillNeeded || null,
  };

  // Research data (Template D)
  const researchData = {
    environmentalTriggers: r.environmentalTriggers || null,
    newInsights:           r.newInsights || r.insightsReceived || null,
    unexpectedExperiences: r.unexpectedExperiences || null,
    patterns:              r.followupPatternsNoticed || null,
    newSymptoms:           r.newSymptoms || null,
  };

  // Long-term tracking (Template E)
  const longTerm = {
    progress:  r.progressSinceLastFollowUp || null,
    setbacks:  r.setbacksSinceLastFollowUp  || null,
    newGoals:  r.newGoals                   || null,
  };

  // Urgency detection
  const supportText = (r.additionalSupportNeeded || r.supportStillNeeded || '').toLowerCase();
  const isUrgent    = URGENCY_PHRASES.some(p => supportText.includes(p)) ||
                      symptomsWorsened.some(s => s.toLowerCase().includes('crisis') || s.toLowerCase().includes('urgent'));

  return {
    intensityNum, intensityDir, sleepDir,
    improvements, challenges,
    recommendationsFollowed, recommendationsIgnored,
    symptomsWorsened, outcomes, researchData, longTerm,
    isUrgent, supportText,
  };
}

// ── Summary generation ────────────────────────────────────────────────────────

function generateSummary(signals, followupType, templateUsed) {
  const lines = [];

  if (signals.intensityDir === 'improving')  lines.push(`Intensity ${signals.intensityNum}/10 — clear improvement.`);
  else if (signals.intensityDir === 'processing') lines.push(`Intensity ${signals.intensityNum}/10 — shift still processing (normal at ${followupType}).`);
  else lines.push(`Intensity ${signals.intensityNum}/10 — elevated; may need attention.`);

  if (signals.sleepDir === 'improved') lines.push('Sleep improved post-session.');
  if (signals.sleepDir === 'worsened') lines.push('Sleep disrupted — possible clearing activity.');

  if (signals.improvements.length > 0) {
    lines.push(`Improvements: ${signals.improvements.slice(0, 3).map(s => s.substring(0, 80)).join(' | ')}`);
  }
  if (signals.challenges.length > 0) {
    lines.push(`Still active: ${signals.challenges.slice(0, 2).map(s => s.substring(0, 80)).join(' | ')}`);
  }
  if (signals.recommendationsFollowed.length > 0) {
    lines.push(`Aftercare followed: ${signals.recommendationsFollowed.slice(0, 4).join(', ')}`);
  }
  if (signals.recommendationsIgnored.length > 0) {
    lines.push(`Not followed: ${signals.recommendationsIgnored[0].substring(0, 120)}`);
  }
  if (signals.symptomsWorsened.length > 0) {
    lines.push(`Watch: ${signals.symptomsWorsened.join(', ')}`);
  }
  if (signals.researchData.environmentalTriggers) {
    lines.push(`Triggers: ${signals.researchData.environmentalTriggers.substring(0, 120)}`);
  }
  if (signals.researchData.newInsights) {
    lines.push(`Insights: ${signals.researchData.newInsights.substring(0, 120)}`);
  }
  if (signals.longTerm.progress) {
    lines.push(`Long-term progress: ${signals.longTerm.progress.substring(0, 120)}`);
  }
  if (signals.longTerm.newGoals) {
    lines.push(`New goals: ${signals.longTerm.newGoals.substring(0, 120)}`);
  }
  if (templateUsed) {
    lines.push(`Template ${templateUsed} used (${followupType} rotation).`);
  }
  if (signals.isUrgent) {
    lines.push('ALERT: Client indicated need for additional support or another session.');
  }

  return lines.join('\n');
}

// ── Main processor ────────────────────────────────────────────────────────────

async function processFollowup(sb, ctx) {
  const { aftercare_id, client_id, followup_type, response_data, template_used } = ctx;

  const signals = extractSignals(response_data);
  const summary = generateSummary(signals, followup_type, template_used);

  const processorOutput = {
    processed_at:  new Date().toISOString(),
    template_used: template_used || null,
    followup_type,
    signals: {
      intensity_num:            signals.intensityNum,
      intensity_dir:            signals.intensityDir,
      sleep_dir:                signals.sleepDir,
      improvements_count:       signals.improvements.length,
      challenges_count:         signals.challenges.length,
      recommendations_followed: signals.recommendationsFollowed,
      recommendations_ignored:  signals.recommendationsIgnored,
      symptoms_worsened:        signals.symptomsWorsened,
      is_urgent:                signals.isUrgent,
    },
    outcomes:    signals.outcomes,
    research:    signals.researchData,
    long_term:   signals.longTerm,
  };

  // 1. Update aftercare record — summary + processed output + alert flag
  try {
    await sb.from('aftercare').update({
      ai_summary:                summary,
      followup_processor_output: processorOutput,
      practitioner_alert:        signals.isUrgent,
    }).eq('id', aftercare_id);
  } catch (e) {
    console.warn('[followup-processor] aftercare update error:', e.message);
  }

  // 2. Write to audit_log — feeds research center + knowledge center
  try {
    await sb.from('audit_logs').insert({
      action:     'aftercare_processed',
      table_name: 'aftercare',
      record_id:  aftercare_id,
      actor:      'system',
      new_data: {
        aftercare_id, client_id, followup_type, template_used,
        signals: processorOutput.signals,
        summary,
        processed_at: processorOutput.processed_at,
      },
    });
  } catch (e) {
    console.warn('[followup-processor] audit insert error:', e.message);
  }

  // 3. Update client record with latest outcome intelligence
  if (client_id) {
    try {
      await sb.from('clients').update({
        last_checkin_at:        new Date().toISOString(),
        last_intensity_score:   signals.intensityNum,
        practitioner_alert:     signals.isUrgent || false,
      }).eq('id', client_id);
    } catch (e) {
      // Column may not exist — non-fatal
      console.warn('[followup-processor] client update skipped:', e.message);
    }
  }

  return { summary, signals: processorOutput.signals, isUrgent: signals.isUrgent };
}

module.exports = { extractSignals, generateSummary, processFollowup };
