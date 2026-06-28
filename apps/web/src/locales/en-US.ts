export const enUS = {
  common: {
    cancel: "Cancel",
    delete: "Delete",
    save: "Save",
    close: "Close",
    retry: "Retry",
    refresh: "Refresh page",
    reset: "Reset UI",
    publish: "Publish",
    back: "Back",
    backHome: "Back to home",
    edit: "Edit",
    deleting: "Deleting",
    listSeparator: ", ",
    reportSeparator: "; ",
    labelSeparator: ": "
  },
  guard: {
    leaveTitle: "Leave this page?",
    leaveBody: "You have unsaved changes that will be lost. Leave anyway?",
    leaveConfirm: "Leave",
    leaveCancel: "Stay"
  },
  error: {
    boundaryTitle: "UI error",
    boundaryBody: "An unexpected error occurred. Try resetting the UI state or refresh the page.",
    notFoundTitle: "Path not found",
    notFoundBody: "The current URL is not a valid screening page. Return home, view history, or create a new run.",
    notFoundHistory: "History",
    notFoundNew: "New run",
    restoringTitle: "Restoring run",
    restoreFailedTitle: "Cannot restore this run",
    restoreFailedBody: "The run does not exist or the service cannot read it right now.",
    restoringBody: "Reading current run state and content."
  },
  status: {
    seat: {
      not_started: "Waiting",
      entered: "Active",
      watching: "Active",
      hesitating: "Doubting",
      viewing_comments: "Reading comments",
      liked: "Liked",
      favorited: "Favorited",
      commented: "Commented",
      skipped: "Skipped",
      risk_exit: "Doubt-exit",
      finished: "Done",
      failed: "Failed"
    },
    lifecycle: {
      not_started: "Not started",
      failed: "Failed",
      left: "Left",
      active: "Active"
    },
    run: {
      planning_audience: "Planning audience",
      generating_audience: "Generating audience",
      audience_ready: "Audience ready",
      pausing: "Pausing",
      paused: "AI screening paused",
      completed: "Run ended · Replay",
      report_generating: "Run ended · Replay",
      running: "AI screening"
    },
    historyRun: {
      draft: "Draft",
      planning_audience: "Planning",
      generating_audience: "Generating",
      audience_ready: "Ready",
      running: "Running",
      pausing: "Pausing",
      paused: "Paused",
      report_generating: "Done",
      completed: "Done"
    },
    historyAction: {
      viewReport: "View report",
      reviewData: "Replay venue data",
      viewReportGenerating: "Report generating",
      backToVenue: "Back to venue",
      openVenue: "Open venue",
      startRun: "Start run",
      viewProgress: "View progress",
      continuePrep: "Continue prep",
      continueEdit: "Continue editing"
    },
    identity: {
      ready: "Ready",
      generating: "Generating",
      failed: "Failed",
      queued: "Queued",
      pending: "Pending profile"
    }
  },
  console: {
    loadedN: "Loaded {{count}}",
    liveLogs: "Live logs",
    runningLogs: "Run logs",
    collapseLogs: "Collapse",
    expandLogs: "Expand",
    waiting: "Waiting",
    empty: "No logs yet",
    loadMore: "Load more",
    allLoaded: "All logs loaded",
    filter: {
      all: "All",
      generation: "Generation",
      dispatch: "Dispatch",
      thought: "Thought",
      action: "Action",
      result: "Result",
      waiting: "Waiting",
      comment: "Comment",
      control: "Control",
      exception: "Exception"
    }
  },
  recommendation: {
    recommend_publish: "Recommended to publish",
    modify_then_publish: "Revise before publish",
    not_recommend_current_version: "Not recommended",
    recommend_retest: "Retest recommended"
  },
  dimension: {
    firstImpression: "First impression",
    value: "Save value",
    interactionIntent: "Intent to interact",
    trust: "Trust signals",
    risks: "Risk signals"
  },
  commentPreview: {
    question: "Follow-up",
    doubt: "Doubt",
    resonance: "Resonance",
    professional: "Professional pushback"
  },
  audience: {
    profileSummary: "Audience: {{label}}",
    profileSummaryEmpty: "Audience pending",
    unnamed: "Unnamed audience",
    reportValue: {
      target: "Where to edit: {{value}}",
      problem: "Issue: {{value}}",
      direction: "Suggestion: {{value}}",
      example: "Example: {{value}}",
      evidence: "Evidence: {{value}}"
    }
  },
  simulation: {
    note: "These interactions are AI screening simulations, not real platform data."
  },
  report: {
    unit: {
      people: "people",
      count: "items"
    },
    metric: {
      exposedActors: "Exposed",
      openedActors: "Opened",
      readActors: "Read",
      deepReadActors: "Deep read",
      readFullActors: "Full read",
      readSkimActors: "Skimmed",
      readPartialActors: "Partial read",
      likedActors: "Liked",
      favoritedActors: "Favorited",
      commentedActors: "Commented",
      sharedActors: "Shared",
      viewedCommentsActors: "Viewed comments",
      positiveActionActors: "Positive actions",
      exitedActors: "Exited"
    },
    section: {
      comments: "Comment preview",
      risks: "Risks & suggestions",
      verdict: "Recommendation",
      decisionSummary: "Decision summary",
      keyFindings: "Key findings",
      rewriteSuggestions: "Rewrite suggestions",
      funnel: "Behavior funnel",
      mainBlocker: "Main blocker",
      audienceGroup: "Audience group analysis",
      segments: "Segments",
      diagnostics: "Content diagnostics",
      keepAndChange: "Keep / Change",
      revisionPlan: "Revision plan",
      retestPlan: "Retest plan",
      evidence: "Evidence"
    },
    decisionSummary: {
      coreProblem: "Core problem",
      p0Actions: "P0 must-fix",
      p1Actions: "P1 suggested",
      keepItems: "Keep items"
    },
    keyFinding: {
      finding: "Finding",
      evidence: "Evidence",
      impact: "Impact",
      action: "Action",
      empty: "No key findings"
    },
    verdict: {
      confidence: "Confidence",
      headline: "Headline",
      oneSentence: "One-sentence verdict",
      topOpportunity: "Top opportunity",
      topRisk: "Top risk",
      priorityFix: "Priority fix",
      confidenceHigh: "High",
      confidenceMedium: "Medium",
      confidenceLow: "Low"
    },
    funnel: {
      openRate: "Open rate",
      readRateAfterOpen: "Read rate after open",
      deepReadRateAfterOpen: "Deep read rate after open",
      favoriteRateAfterOpen: "Favorite rate after open",
      commentRateAfterOpen: "Comment rate after open",
      shareRateAfterOpen: "Share rate after open",
      positiveActionRate: "Positive action rate",
      audienceCount: "Audience",
      completedCount: "Completed",
      failedCount: "Failed"
    },
    blocker: {
      affectedCount: "Affected",
      severity: "Severity",
      diagnosis: "Diagnosis",
      summary: "Summary",
      severityHigh: "High",
      severityMedium: "Medium",
      severityLow: "Low"
    },
    audienceGroup: {
      coreTargetHit: "Core target hit",
      coreTargetHighInterestLowTrust: "Core target high-interest low-trust",
      peripheralExpansionOpportunity: "Peripheral expansion opportunity",
      contrastSkipExpected: "Contrast skip expected",
      contrastUnexpectedRisk: "Contrast unexpected risk",
      crossGroupSummary: "Cross-group summary",
      noGroups: "No group data",
      exitReasons: "Exit reasons",
      commentIntents: "Comment intents",
      targetAudienceFit: "Target fit",
      modificationWeight: "Feedback weight",
      handlingSuggestion: "Handling suggestion",
      typicalMotivation: "Typical motivation",
      mainBarrier: "Main barrier",
      behaviorEvidence: "Behavior evidence",
      fitHigh: "High",
      fitMedium: "Medium",
      fitLow: "Low",
      weightHigh: "High",
      weightMedium: "Medium",
      weightLow: "Low",
      role: {
        core_target: "Core target",
        peripheral_target: "Peripheral target",
        contrast: "Contrast",
        exploratory: "Exploratory",
        unknown: "Unknown"
      }
    },
    segment: {
      persuaded: "Persuaded",
      interested_but_not_convinced: "Interested but not convinced",
      skipped: "Skipped",
      skeptical: "Skeptical",
      size: "Size",
      percentage: "Share",
      summary: "Summary",
      commonTraits: "Common traits",
      suggestedAction: "Suggested action",
      representativeThoughts: "Representative thoughts",
      representativeComments: "Representative comments",
      empty: "Empty"
    },
    diagnostic: {
      feed_attraction: "Feed attraction",
      reading_retention: "Reading retention",
      trust_evidence: "Trust evidence",
      save_value: "Save value",
      comment_risk: "Comment risk & opportunity",
      status: "Status",
      finding: "Finding",
      evidence: "Evidence",
      reason: "Reason",
      suggestedFix: "Suggested fix",
      statusStrong: "Strong",
      statusMedium: "Medium",
      statusWeak: "Weak",
      statusRisk: "Risk"
    },
    keepAndChange: {
      keep: "Keep",
      change: "Change",
      item: "Item",
      reason: "Reason",
      empty: "None"
    },
    revisionPlan: {
      priority: "Priority",
      title: "Title",
      action: "Action",
      reason: "Reason",
      affectedSegment: "Affected segment",
      expectedImpact: "Expected impact",
      retestQuestion: "Retest question",
      empty: "No revision plan",
      affectedSegmentOverall: "Overall"
    },
    retestPlan: {
      question: "Retest goal",
      hypothesis: "Hypothesis",
      testVersionLabel: "Suggested test version",
      relatedAction: "Related action",
      metricToWatch: "Metric to watch",
      expectedDirection: "Expected direction",
      empty: "No retest plan"
    },
    rewrite: {
      recommendedTitles: "Recommended titles",
      recommendedCoverText: "Recommended cover text",
      recommendedOpening: "Recommended opening",
      recommendedBodyStructure: "Recommended body structure",
      recommendedCommentPrompt: "Recommended comment prompt",
      recommendedTags: "Recommended tags",
      why: "Why this change",
      copy: "Copy",
      copied: "Copied",
      empty: "No rewrite suggestions"
    },
    chart: {
      section: "Core charts",
      funnel: {
        title: "Behavior funnel",
        caption: "Cumulative/progressive: each step counts unique people; downstream steps are subsets of upstream.",
        stageExposed: "Entered test",
        stageOpened: "Opened",
        stageRead: "Read",
        stageDeepRead: "Deep read",
        stageReadFull: "Full read",
        stagePositiveAction: "Positive action",
        stageCommented: "Commented",
        dropHint: "{{count}} fewer than previous stage",
        noDrop: "No drop-off",
        commentEvents: "{{count}} comments total",
        empty: "Sample too small to render this chart. Need at least 3 valid participants.",
        interpOpenLow: "Open rate is low — title/cover attraction is weak.",
        interpSkimHigh: "Title drives clicks, but skim readers dominate — opening doesn't deliver on the title promise.",
        interpFullLow: "Opening retains, but full-read count is low — content value isn't fully recognized.",
        interpStable: "Funnel is stable overall; focus on interaction and favorite stages."
      },
      readDepth: {
        title: "Reading depth distribution",
        caption: "Did users skim, read partially, or read fully?",
        empty: "Sample too small to render this chart.",
        interpSkimHigh: "Skim readers outnumber full readers — issue is in the opening hook.",
        interpFullHigh: "Full readers dominate — content value is recognized; focus on interaction prompts.",
        interpPartialHigh: "Partial readers dominate — topic interests but content follow-through is weak."
      },
      audienceMatrix: {
        title: "Target audience fit matrix",
        caption: "Whose feedback matters more?",
        axisFit: "Target audience fit",
        axisEngagement: "Content reaction strength",
        quadHighFitHighEngage: "Core opportunity",
        quadHighFitLowEngage: "Priority fix",
        quadLowFitHighEngage: "Unexpected expansion",
        quadLowFitLowEngage: "Low reference weight",
        fitHigh: "High",
        fitMedium: "Medium",
        fitLow: "Low",
        engageHigh: "High",
        engageMedium: "Medium",
        engageLow: "Low",
        empty: "No group data, chart skipped."
      },
      priorityMatrix: {
        title: "Issue priority matrix",
        caption: "What to fix first?",
        axisImpact: "Impact level",
        axisCost: "Fix cost",
        quadHighImpactLowCost: "Fix now",
        quadHighImpactHighCost: "Plan carefully",
        quadLowImpactLowCost: "Quick win",
        quadLowImpactHighCost: "Skip for now",
        impactHigh: "High",
        impactMedium: "Medium",
        impactLow: "Low",
        costHigh: "High",
        costMedium: "Medium",
        costLow: "Low",
        empty: "No revision plan, chart skipped."
      },
      interpretation: "Interpretation"
    },
    evidence: {
      drawerTitle: "Evidence detail",
      empty: "No evidence",
      openDrawer: "View evidence",
      closeDrawer: "Close",
      typeMetric: "Metric",
      typeThought: "Thought",
      typeComment: "Comment",
      typeToolCall: "Tool call",
      typeJourney: "Journey",
      typeSegment: "Segment",
      typeBlocker: "Blocker",
      typeGroup: "Group",
      participant: "Participant"
    },
    evidenceQuality: {
      low: "Evidence quality is low",
      lowHint: "Current simulation evidence is insufficient for a reliable judgment. Consider retesting with a larger sample.",
      medium: "Evidence quality is medium",
      high: "Evidence quality is good"
    },
    regenerate: "Regenerate report",
    regenerating: "Regenerating...",
    runInfo: "Run info",
    generatedAt: "Generated at",
    promptVersion: "Prompt version",
    model: "Model",
    runId: "Run ID",
    modelUnknown: "Unknown, needs run log inspection",
    metricDict: {
      readSkim: {
        label: "Skim",
        description: "Unique people who glanced or stayed briefly (deduped by person)."
      },
      readPartial: {
        label: "Partial read",
        description: "Unique people who read part of the content then left (deduped by person)."
      },
      readFull: {
        label: "Full read",
        description: "Unique people who read essentially the entire content (deduped by person)."
      },
      exposed: {
        label: "Exposed",
        description: "Unique people who entered the screening test. Top of the funnel."
      },
      opened: {
        label: "Opened",
        description: "Unique people who entered the content detail page. Title had initial pull."
      },
      viewedComments: {
        label: "Viewed comments",
        description: "Unique people who opened the comment section. Content triggered further engagement."
      },
      liked: {
        label: "Liked",
        description: "Unique people who liked (state action, each person counted once)."
      },
      favorited: {
        label: "Favorited",
        description: "Unique people who favorited (state action, each person counted once)."
      },
      commented: {
        label: "Commented",
        description: "Unique people who wrote at least one comment (deduped by person; one person can write multiple comments)."
      },
      shared: {
        label: "Shared",
        description: "Unique people who shared (deduped by person)."
      },
      exited: {
        label: "Exited",
        description: "Unique people who ended browsing. Combine with reading depth / exit reason to tell normal vs risk exit."
      },
      openRate: {
        label: "Open rate",
        description: "Opened people / Exposed people. Reflects title + cover pull."
      },
      readRateAfterOpen: {
        label: "Read rate after open",
        description: "Read people / Opened people. Reflects opening hook."
      },
      favoriteRateAfterOpen: {
        label: "Favorite rate after open",
        description: "Favorited people / Opened people. Reflects tool / reference value."
      },
      commentRateAfterOpen: {
        label: "Comment rate after open",
        description: "Commented people / Opened people. Reflects expression-triggering power."
      },
      shareRateAfterOpen: {
        label: "Share rate after open",
        description: "Shared people / Opened people. Reflects virality."
      },
      positiveActionRate: {
        label: "Positive action rate",
        description: "People with at least one positive action / Opened people. Overall interaction-triggering power."
      }
    }
  },
  venueHud: {
    aiSimulation: "AI simulation",
    simProgress: "Sim progress",
    simTime: "Sim time",
    skipN: "Skipped {{count}}",
    failN: "Failed {{count}}",
    resetRun: "Reset run",
    viewReport: "View report",
    endAndReport: "End & generate report",
    backHome: "Back to home",
    resume: "Resume",
    pausing: "Pausing",
    pause: "Pause",
    completed: "Run ended",
    waiting: "Waiting",
    resetRuntimeTitle: "Reset run data",
    resetRuntimeDisabledRunning: "Cannot reset while running",
    resetRuntimeDisabledPausing: "Cannot reset while pausing",
    resetRuntimeDisabledOther: "Cannot reset in current state",
    reportTitlePaused: "End current run and generate a stage report",
    reportTitleCompleted: "View the full run report",
    reportTitleDisabled: "Available after pause or complete"
  },
  venue: {
    audienceSeat: "Audience",
    runtimeLog: "Run logs",
    audiencePanel: "AI audience",
    currentActive: "Active",
    noMatch: "No matching audience",
    drawerTitle: "Audience detail",
    closeDetail: "Close detail",
    closeEdit: "Close edit",
    drawerLoading: "Loading...",
    drawer: {
      roleBackground: "Background",
      personality: "Personality",
      mbti: "MBTI",
      responseStyle: "Response style",
      finalFeedback: "Final feedback",
      comments: "Comments this run",
      noComments: "No comments.",
      timeline: "Behavior & thought timeline",
      noTimeline: "No timeline events.",
      noBehavior: "No behavior",
      exitReasonCategory: "Exit reason",
      exitReadingDepth: "Reading depth",
      exitInterestLevel: "Interest level",
      exitTrustLevel: "Trust level",
      commentIntent: "Comment intent"
    },
    exitReasonCategory: {
      not_relevant: "Not relevant to me",
      not_interested: "Not interested",
      low_trust: "Low trust",
      too_ad_like: "Too ad-like",
      content_too_long: "Content too long",
      need_more_evidence: "Need more evidence",
      finished_normally: "Finished normally",
      no_more_action: "No more action"
    },
    readingDepth: {
      feed_only: "Feed only",
      skimmed: "Skimmed",
      partial: "Partial",
      full: "Full read"
    },
    level: {
      low: "Low",
      medium: "Medium",
      high: "High"
    },
    commentIntent: {
      ask: "Ask",
      doubt: "Doubt",
      share_experience: "Share experience",
      agree: "Agree",
      joke: "Joke",
      pushback: "Pushback"
    },
    legend: {
      active: "Active",
      left: "Left",
      failed: "Failed",
      doubt: "Doubt",
      comment: "Comment",
      favorite: "Favorite",
      share: "Share",
      like: "Like",
      open: "Open"
    },
    legendAria: "Audience legend",
    comment: {
      allCount: "{{count}} comments",
      burst: "+{{delta}} new",
      hot: "Hot",
      latest: "Latest",
      placeholder: "Say something...",
      placeholderClosed: "Run ended, comments closed",
      ariaLabel: "Comment content",
      loadMore: "Load more comments",
      allLoaded: "All comments loaded",
      like: "Like comment",
      unlike: "Unlike comment",
      reply: "Reply",
      minuteAgo: "1 minute ago",
      replies: "{{count}} replies"
    },
    action: {
      unlike: "Unlike",
      like: "Like",
      unfavorite: "Unfavorite",
      favorite: "Favorite",
      share: "Share"
    },
    post: {
      redBook: "RedBook",
      follow: "Follow",
      author: "Chen Lin",
      prevImage: "Previous image",
      nextImage: "Next image",
      tapToZoom: "Tap to zoom",
      expandBody: "Expand body",
      collapseBody: "Collapse body",
      imageHidden: "Image hidden",
      contentImageAlt: "Run content image",
      contentPreview: "Run content preview",
      simulatedPage: "RedBook simulation"
    },
    timeline: {
      thought: "Thought",
      action: "Action",
      comment: "Comment",
      exception: "Exception",
      result: "Result"
    },
    exitOutcome: {
      skipped: "Skipped",
      browsed_and_left: "Browsed and left",
      risk_exit: "Doubt-exit",
      max_steps: "Reached step limit"
    },
    resetRun: "Run data reset",
    resetRunTitle: "Reset run data?",
    resetRunBody: "This will clear run logs, interactions, comments, report and behavior counters. Content and audience personas are kept. You can restart the run afterwards.",
    resetRunConfirm: "Reset run",
    startWithReadyTitle: "Start with only ready audience?",
    startWithReadyBody: "{{ready}} audience personas are ready, {{missing}} are still generating and won't join this run.",
    startWithReadyConfirm: "Start anyway",
    reportTitle: "Run report",
    reportBackHome: "Back to home",
    reportReviewData: "Replay venue data",
    reportNotAvailable: "Report not available. Replay venue data to check the current run status.",
    reportLoading: "Loading report..."
  },
  home: {
    title: "AI user screening workbench",
    history: "History",
    settings: "Settings",
    field: {
      title: "Title",
      cover: "Cover image",
      body: "Body"
    },
    image: {
      upload: "Upload image",
      selectCount: "Select {{current}}/{{max}}",
      addMore: "Add more {{current}}/{{max}}",
      limitHint: "Over {{bytes}} will be compressed first. Longest edge ≤ {{edge}}px.",
      uploadFailed: "Image upload failed",
      maxImages: "Up to {{max}} images",
      processing: "Processing image"
    },
    publishTitle: "Publish to AI screening venue",
    publishBody: "AI audience with different personas will enter the venue, simulating opens, favorites, comments, doubts and skips.",
    useDemo: "Use demo content",
    demoOverwrite: {
      title: "Replace the current draft with demo content?",
      body: "The current draft has content and will be replaced with the demo title, body and images. Page navigation keeps your draft; only confirming this action changes it.",
      confirm: "Replace draft",
      cancel: "Keep current draft"
    },
    generate: "Generate AI audience",
    preset: {
      quick: "Quick run",
      quickDesc: "12 audience",
      standard: "Standard run",
      standardDesc: "30 audience",
      custom: "Custom count",
      customDesc: "{{count}} audience"
    },
    audienceCount: "Audience count",
    audienceCountAria: "Custom audience count",
    audienceCountHigh: "Large audience count increases model calls and wait time. Suggest keeping ≤ 100 for quick exploration.",
    audienceCountRange: "{{min}}-{{max}} allowed. Quick exploration suggested ≤ 100."
  },
  audienceGen: {
    title: {
      planFailed: "Audience plan failed",
      planning: "Planning audience structure",
      generating: "Generating run audience",
      confirm: "Confirm run audience",
      review: "Review sampling plan"
    },
    status: {
      failed: "Failed",
      generating: "Generating",
      ready: "Ready",
      pending: "Pending review"
    },
    action: {
      clearAudience: "Clear audience",
      askAI: "Ask AI",
      retryFailed: "Retry failed personas",
      confirmAndGenerate: "Confirm plan & generate personas",
      resetRun: "Reset run",
      startRun: "Start run"
    },
    runtimeTitle: {
      planFailed: "Audience plan failed",
      planning: "Planning audience structure",
      progress: "Audience generation progress",
      review: "Sampling plan review"
    },
    runtimeDock: "Audience generation runtime",
    generated: "Generated",
    planned: "Planned",
    dimension: "Split axes",
    dimensionGenerating: "Split axes generating",
    planNote: "Plan note",
    planNoteGenerating: "Plan note generating",
    directive: {
      groupN: "Group {{index}}",
      name: "Group name",
      quantity: "Count",
      description: "Group description",
      diversityAxes: "Intra-group diversity axes",
      rationale: "Why this allocation",
      reason: "Reason:",
      target: "Target {{count}}",
      people: "people",
      namePlaceholder: "Group name required",
      diversityEmpty: "Empty",
      diversityAddPlaceholder: "Type and press Enter to add",
      diversityAdd: "Add",
      diversityAria: "Added diversity axes",
      diversityRemove: "Remove {{axis}}",
      diversityNew: "New diversity axis",
      previewName: "Preview group {{name}}",
      previewGenerating: "Preview group generating",
      nameGenerating: "Group name generating",
      descGenerating: "Group description generating",
      reasonGenerating: "Allocation reason generating",
      countGenerating: "Group count generating",
      countAssigning: "Count assigning",
      coverageJumpAria: "Jump to group {{index}} {{name}}",
      identityReadyAria: "{{ready}} / {{total}} ready"
    },
    review: {
      complete: "Complete",
      incomplete: "Incomplete fields",
      generating: "Generating"
    },
    confirm: {
      replanTitle: "Replan audience structure?",
      replanBody: "Unentered audience structure, generated personas and saved state will be replaced. Use when the coverage direction is clearly wrong.",
      replanConfirm: "Replan",
      clearTitle: "Clear audience?",
      clearBody: "Will delete currently generated profiles and personas, keep the confirmed structure, and return to structure review. You can keep editing or replan the whole structure.",
      clearConfirm: "Clear audience",
      deleteDirectiveTitle: "Delete this group?",
      deleteDirectiveBody: "Will remove \"{{description}}\" from the sampling plan. After deletion, recheck whether total count still equals target.",
      deleteDirectiveConfirm: "Delete group",
      deleteAudienceTitle: "Delete this audience?",
      deleteAudienceBody: "Will delete \"{{label}}\" and related persona, identity and downstream run entry. Use when sampling is duplicated or clearly unneeded.",
      deleteAudienceConfirm: "Delete audience",
      regenerateTitle: "Regenerate this persona?",
      regenerateTitlePending: "Generate persona for this profile?",
      regenerateBodyReady: "Will regenerate \"{{label}}\"'s persona content. Current background, personality, MBTI and response style will be replaced.",
      regenerateBodyPending: "Will generate a concrete persona based on \"{{label}}\"'s sampling info. The profile will enter queued or generating state.",
      regenerateConfirmReady: "Regenerate",
      regenerateConfirmPending: "Generate persona"
    },
    toast: {
      cleared: "Audience cleared",
      saved: "Group plan saved",
      deleted: "Group deleted",
      reset: "Run data reset",
      planFailed: "Sampling plan missing or last attempt failed. Replan.",
      planError: "Sampling plan failed. Regenerate the whole plan.",
      maxImages: "Up to {{max}} images",
      imageFailed: "Image upload failed",
      invalidQuantity: "Group count must be a positive integer",
      emptyName: "Group name required",
      emptyDesc: "Group description required",
      emptyDiversity: "At least one diversity axis required",
      emptyRationale: "Allocation rationale required",
      appliedAdd: "Applied: add group",
      appliedAddResult: "Added to sampling plan",
      appliedUpdate: "Applied: update group",
      appliedUpdateResult: "Updated sampling plan",
      appliedDelete: "Applied: delete group",
      appliedDeleteResult: "Removed from sampling plan",
      appliedAddProfile: "Applied: add audience",
      appliedAddProfileResult: "Added audience and started persona generation",
      appliedUpdateProfile: "Applied: update audience",
      appliedUpdateProfileResult: "Updated audience persona",
      appliedRegenerate: "Applied: regenerate persona",
      appliedRegenerateResult: "Started persona regeneration",
      appliedDeleteProfile: "Applied: delete audience",
      appliedDeleteProfileResult: "Removed audience",
      appliedFavorite: "Applied: favorite persona",
      appliedUnfavorite: "Applied: unfavorite",
      appliedFavoriteResult: "Favorited persona",
      appliedUnfavoriteResult: "Unfavorited",
      appliedRetry: "Applied: retry failed",
      appliedRetryResult: "Started retry",
      cannotOptimizePlan: "Cannot optimize distribution in current state",
      cannotPolishSeat: "Cannot polish persona in current state",
      sseError: "Received an unparseable live event, ignored and continuing.",
      refreshFailed: "Venue data refresh failed: {{errors}}",
      updating: "Updating",
      applyFailed: "Apply failed"
    },
    reasoning: {
      thinking: "Thinking",
      thinkingTokens: "Thinking {{prefix}}{{count}} token",
      planning: "Planning",
      replan: "Replan"
    },
    quantityDelta: {
      more: "+{{count}}",
      less: "-{{count}}",
      unsaved: "Unsaved edits",
      unsavedWithDelta: "Unsaved edits, {{delta}}"
    },
    expansion: {
      generating: "Expanding profiles...",
      failed: "Profile expansion failed",
      queued: "Profile queued..."
    },
    detail: {
      toggleFavorite: "Favorite persona",
      toggleUnfavorite: "Unfavorite persona",
      regenerate: "Regenerate persona",
      delete: "Delete",
      retry: "Retry",
      generate: "Generate",
      retryIdentity: "Retry identity",
      generateIdentity: "Generate persona",
      deleteAria: "Delete {{name}}",
      detailAria: "{{name}} audience detail"
    },
    assistant: {
      planTitle: "Optimize distribution",
      seatTitle: "Polish personas",
      planSubtitle: "Review suggestions first, then decide whether to apply.",
      seatSubtitle: "Review audience suggestions first, then decide whether to apply.",
      planPlaceholder: "Describe groups to add, split, or remove",
      seatPlaceholder: "Describe audience to adjust, regenerate, or keep"
    }
  },
  history: {
    title: "History",
    backHome: "Back to home",
    loading: "Loading history...",
    emptyTitle: "No history yet",
    emptyBody: "No recoverable run records",
    newRun: "New run",
    bodyPreviewEmpty: "No body preview",
    identityReady: "Personas ready",
    participants: "audience",
    hasReport: "Has report",
    loadMore: "Load more",
    deleted: "Run deleted",
    delete: {
      title: "Delete this run?",
      irrecoverable: "Irreversible",
      body: "\"{{title}}\"'s report, logs, comments, audience personas and local uploads will be cleaned. Cannot be undone.",
      confirm: "Delete",
      tooltip: "Delete run",
      tooltipDisabled: "Running or report-generating runs cannot be deleted directly"
    },
    listAria: "History list"
  },
  settings: {
    title: "Model & gateway settings",
    backHome: "Back to home",
    saveSettings: "Save settings",
    saving: "Saving",
    saved: "Saved",
    loadingSettings: "Loading settings...",
    tabs: {
      aria: "Settings sections",
      ai: "AI settings",
      system: "System settings"
    },
    model: {
      title: "Model settings",
      runtimeMode: "Runtime mode",
      mock: "Mock mode",
      mockDesc: "Local simulation, no real model calls",
      real: "Real mode",
      realDesc: "Use API key, base URL and model config",
      apiKey: "API key",
      apiKeyModified: "Modified",
      baseUrl: "API base URL",
      baseUrlPlaceholder: "Required, e.g. https://api.openai.com/v1",
      fetchModels: "Fetch model list",
      modelsCount: "{{count}} models available",
      modelsEmpty: "Fill base URL and key in real mode to request /models",
      fast: "Fast model",
      fastPlaceholder: "For batch generation and run turns",
      fastUsage1: "Profile expansion",
      fastUsage2: "Batch persona generation",
      fastUsage3: "Audience behavior turns in run",
      pro: "Pro model",
      proHint: "Must support image input",
      proPlaceholder: "For image understanding, planning, Q&A and report",
      proUsage1: "Sampling plan",
      proUsage2: "Optimize distribution",
      proUsage3: "Polish personas",
      proUsage4: "Run report",
      noMatch: "No matching model",
      listAria: "{{label}} model list",
      usageAria: "Model usage scenarios",
      restoreDefault: "Restore defaults",
      restoreTooltip: "Restore API key, model config and runtime mode to defaults. Clears currently saved model settings.",
      restoreTitle: "Restore defaults?",
      restoreBody: "Current API key, model config and runtime mode will be reset to defaults. Cannot be undone.",
      restoreConfirm: "Restore",
      restoreCancel: "Keep current",
      savedMock: "Mock runtime selected",
      savedReal: "Real model runtime selected",
      savedToast: "Model settings saved, {{mode}}"
    },
    capacity: {
      title: "Capacity control",
      refresh: "Refresh capacity status",
      refreshTooltip: "Refresh current model capacity, concurrency and rate-limit status.",
      statusAria: "LLM runtime status",
      statusLabel: "Status",
      effectiveRpm: "Effective RPM",
      effectiveConcurrency: "Effective concurrency",
      configuredMaxRpm: "Ceiling {{count}}",
      configuredMaxConcurrency: "Ceiling {{count}}",
      inFlight: "In flight",
      queueSize: "Queued",
      cooldownUntil: "Cooldown until {{time}}",
      recentLimit: "Recent rate-limit {{count}} times{{reason}}",
      mode: "Strategy",
      modeAuto: "Auto (recommended)",
      modeManual: "Manual",
      modeAutoDesc: "System auto-tunes RPM and concurrency based on probe results, adapting to rate limits in real time.",
      modeManualDesc: "Fixed RPM and concurrency ceiling. Use when model quota is known.",
      probe: "Probe current model",
      probing: "Probing...",
      resetLearning: "Reset learning",
      preset: {
        conservative: "Conservative",
        standard: "Standard",
        high_quota: "High quota",
        custom: "Custom"
      },
      probeResult: "Probe result",
      probeSummary: "Recommended concurrency {{concurrency}}: measured RPM {{rpm}} at this level, effective value uses 75% safety margin → RPM {{recommended}}.",
      probeRecommendedRpm: "Recommended RPM",
      probeRecommendedConcurrency: "Recommended concurrency",
      probeAvgLatency: "Avg latency",
      probeTokens: "Tokens consumed",
      probeTestedRpm: "Tested RPM",
      probeTestedConcurrency: "Tested concurrency",
      appliedRecommended: "Recommended values applied",
      applyRecommended: "Apply recommended",
      advanced: "Advanced",
      presetSection: "Capacity presets",
      presetAria: "Capacity presets",
      boundary: "Numeric bounds",
      initialRpm: "Initial RPM",
      minRpm: "Min RPM",
      maxRpm: "Max RPM",
      initialConcurrency: "Initial concurrency",
      minConcurrency: "Min concurrency",
      maxConcurrency: "Max concurrency",
      maxRetries: "Max retries",
      probeProgressAria: "Probe progress",
      probePreparing: "Preparing",
      probeCooling: "Cooling",
      probeTesting: "Probing",
      probeCooldownLeft: "Test level {{level}} in {{time}}",
      probeLevelRemaining: "{{level}} · ends in {{time}}",
      probeCancel: "Cancel probe",
      probeCurrentSent: "Sent {{count}}",
      probeCurrentSuccess: "Success {{count}}",
      probeCurrentFailed: "Failed {{count}}",
      probeCurrentTokens: "Tokens {{count}}",
      probeCurrentElapsed: "Elapsed {{time}}",
      probeCurrentLatency: "Latency {{latency}}",
      probeCurrentLatencyNone: "Latency none",
      probeTotalSent: "Total sent {{count}}",
      probeTotalTokens: "Total tokens {{count}}",
      probeLevelHeader: "Completed levels",
      probeLevelHint: "Compare real throughput across concurrency levels",
      probeLevelConcurrency: "Concurrency",
      probeLevelRequests: "Requests",
      probeLevelSuccess: "Success",
      probeLevelFailed: "Failed",
      probeLevelRpm: "RPM",
      probeLevelSuccessRate: "Success rate",
      probeLevelLatency: "Latency",
      probeLevelTokens: "Tokens",
      probeLevelRecommended: "Recommended",
      probeLevelNone: "None",
      probeLevelTableAria: "Completed levels table",
      probeConfirmTitle: "Probe current model?",
      probeConfirmBody: "Probe sends real requests by concurrency level, each level ~60s with cooldown between levels. May take minutes and incur API fees. High-quota or custom ceilings may consume ~100k-300k tokens. Uses ultra-short prompts and 1-token output to lower cost.",
      probeConfirmLabel: "Start probe",
      probeCancelled: "Probe cancelled, no recommended values applied",
      probeCompleted: "Probe complete: recommended RPM {{rpm}}, concurrency {{concurrency}}",
      probeFailed: "Probe failed",
      resetConfirmTitle: "Reset auto-learning?",
      resetConfirmBody: "Current RPM and concurrency will return to initial values. Accumulated success counts and rate-limit records will be cleared.",
      resetConfirmLabel: "Reset",
      resetDone: "Auto-learning reset",
      appliedToast: "Recommended values applied: effective RPM {{rpm}}, concurrency {{concurrency}}. Probe ceiling RPM {{testedRpm}}, concurrency {{testedConcurrency}} saved as auto-mode ceiling."
    },
    guard: {
      title: "Leave settings?",
      body: "You have unsaved setting changes that will be lost. Leave anyway?",
      confirm: "Leave",
      cancel: "Stay"
    },
    saveConfirmTitle: "Save settings?",
    saveConfirmBody: "Current settings will take effect after saving.",
    saveConfirmLabel: "Save"
  },
  audienceDrawer: {
    mbti: {
      ISTJ: "Inspector", ISFJ: "Protector", INFJ: "Advocate", INTJ: "Architect",
      ISTP: "Virtuoso", ISFP: "Adventurer", INFP: "Mediator", INTP: "Logician",
      ESTP: "Entrepreneur", ESFP: "Entertainer", ENFP: "Campaigner", ENTP: "Debater",
      ESTJ: "Executive", ESFJ: "Consul", ENFJ: "Protagonist", ENTJ: "Commander"
    },
    demographics: {
      gender: "Gender",
      ageRange: "Age range",
      cityTier: "City tier",
      lifeStage: "Life stage",
      role: "Role",
      spendingPower: "Spending power"
    },
    editTitle: "Edit {{name}} persona",
    viewTitle: "{{label}}",
    editSubtitle: "Adjust this audience's background, personality, MBTI and response style.",
    viewSubtitle: "Review this sampling profile. Decide whether to generate a concrete persona.",
    modifyAvatar: "Change avatar",
    avatar: {
      uploading: "Uploading",
      upload: "Upload image",
      useDefault: "Use default avatar",
      failed: "Avatar upload failed",
      uploadAria: "Upload avatar image"
    },
    namePlaceholder: "Unnamed audience",
    profilePending: "Profile pending · sampling slot",
    personaSection: "Agent persona",
    personaHint: "Stable identity and community interaction style for this audience",
    profileText: "Background",
    profileHint: "Life experience, current situation and long-term habits.",
    personality: "Personality",
    personalityHint: "Character, values and decision preferences.",
    mbtiType: "MBTI type",
    mbtiHint: "Pick one of 16 types (Chinese name in parentheses).",
    responseStyle: "Response style",
    responseStyleHint: "Browsing judgment, interaction tendency and comment style.",
    profileOnly: "Profile only",
    profileOnlyHint: "Sampling slot, no concrete persona yet",
    profileOnlyBody: "This profile is used for coverage and dedup only. After generating a persona, background, personality, MBTI and response style will appear.",
    samplingSection: "Sampling info",
    samplingHint: "Read-only. Used to trace this Agent's origin.",
    samplingLabel: "Sampling labels",
    samplingLabelEmpty: "No sampling labels",
    deletePersona: "Delete persona",
    deleteProfile: "Delete profile",
    savePersona: "Save persona",
    generatePersona: "Generate persona",
    nameAria: "Nickname",
    identityPreview: "Audience identity preview"
  },
  assistant: {
    stage: {
      plan: "Sampling plan",
      seat: "Audience"
    },
    empty: {
      planTitle: "No suggestions yet",
      seatTitle: "No polish suggestions yet",
      planBody: "Describe groups to add, split, or remove.",
      seatBody: "Describe audience to adjust, regenerate, or keep."
    },
    mentioned: "Mentioned {{count}}",
    mentionHint: "Use @ to mention groups or audience",
    mentionSearch: "Search: {{query}}",
    mentionEmpty: "Mentionable",
    mentionAria: "Mentioned items",
    noMatch: "No match",
    applyAll: "Apply all",
    apply: "Apply",
    send: "Send",
    discussionOnly: "No changes needed.",
    operation: {
      add_directive: "Add group",
      update_directive: "Update group",
      delete_directive: "Delete group",
      update_identity: "Update audience",
      regenerate_identity: "Regenerate persona",
      delete_profile: "Delete audience",
      favorite_identity: "Favorite state",
      retry_identity: "Retry persona",
      add_profile: "Add audience"
    },
    status: {
      running: "Updating",
      success: "Applied",
      failed: "Failed",
      not_applicable: "Unavailable",
      idle: "Idle"
    },
    field: {
      name: "Group name",
      description: "Group description",
      quantity: "Count",
      diversityAxes: "Diversity axes",
      rationale: "Allocation rationale",
      sortOrder: "Sort order",
      displayName: "Nickname",
      avatarUrl: "Avatar",
      personaJson: "Persona"
    },
    diff: {
      emptyValue: "Empty",
      people: "people",
      favoriteLabel: "Favorite state",
      favorite: "Favorite",
      unfavorite: "Unfavorite",
      samplingLabel: "Sampling labels",
      demographics: "Demographics",
      demographicsEmpty: "Pending"
    }
  },
  imageViewer: {
    coverPreview: "Cover preview",
    imageN: "Image {{index}}",
    cover: "Cover",
    deleteImage: "Delete image {{index}}",
    viewImage: "View image",
    closeViewer: "Close viewer",
    closeHint: "Close hint"
  },
  seatFilter: {
    all: "All",
    active: "Active",
    opened: "Opened",
    commented: "Commented",
    favorited: "Favorited",
    skipped: "Skipped",
    doubt: "Doubt",
    finished: "Done",
    failed: "Failed"
  },
  audienceStatus: {
    failed: "Failed",
    ready: "Ready",
    partial: "Partial",
    generating: "Generating",
    pending: "Pending"
  },
  audienceFact: {
    profileEmpty: "Background pending",
    sampleEmpty: "Sampling info pending",
    unlimited: "Unlimited",
    consumption: "Spending"
  },
  runtimeLog: {
    commentPrefix: "Comment: "
  },
  runtimeEvent: {
    open_post: "An audience member opened the content",
    read_post: "An audience member read the post",
    like_post: "An audience member liked this content",
    favorite_post: "An audience member favorited this content",
    share_post: "An audience member shared this content",
    write_comment: "An audience member commented",
    like_comment: "An audience member liked a comment",
    exit_browsing: "An audience member finished browsing",
    fallback: "An audience member performed an action"
  },
  apiError: {
    responseReadFailed: "Cannot read server response. Verify the API service is running.",
    emptyResponse: "Server returned an empty response. Try again later.",
    httpError: "Request failed (HTTP {{status}}). Verify the API service is running.",
    invalidJsonResponse: "Server returned a non-JSON response. Verify the API service is running.",
    networkError: "Cannot connect to API service. Verify the backend is running and retry."
  },
  imageError: {
    unsupportedType: "Only jpg/png/webp images are supported",
    canvasUnsupported: "Browser does not support image compression",
    tooLarge: "Image still exceeds {{size}} after compression. Try a smaller original.",
    unreadable: "Image cannot be read",
    compressFailed: "Image compression failed"
  },
  language: {
    title: "UI language",
    description: "Choose the UI display language. It takes effect after saving and is remembered on this device.",
    zh: "简体中文",
    en: "English"
  }
} as const;
