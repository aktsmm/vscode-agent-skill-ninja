// skill-index.json を英語ベースに移行するスクリプト
// 現在の description を description_ja に移動し、
// description には英語の説明を生成（スキル名ベース）

const fs = require("fs");
const path = require("path");

const indexPath = path.join(__dirname, "..", "resources", "skill-index.json");
const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));

// スキル名から英語説明を生成するマッピング
const englishDescriptions = {
  // Anthropic Skills
  "algorithmic-art": "Generate algorithmic art and creative visualizations",
  "brand-guidelines": "Create and manage brand guidelines",
  "canvas-design": "Create canvas designs and layouts",
  "doc-coauthoring": "Collaborative document co-authoring",
  docx: "Process Word documents (.docx)",
  pdf: "Process PDF files",
  pptx: "Process PowerPoint presentations (.pptx)",
  xlsx: "Process Excel spreadsheets (.xlsx)",
  "frontend-design": "Create frontend designs and UI layouts",
  "web-artifacts-builder": "Build web artifacts and components",
  "webapp-testing": "Test web applications",
  "mcp-builder": "Build MCP (Model Context Protocol) servers",
  "internal-comms": "Internal communications management",
  "invoice-organizer": "Organize and manage invoices",
  "skill-creator": "Create new agent skills",
  "skill-share": "Share skills across teams",
  "slack-gif-creator": "Create GIFs for Slack",
  "template-skill": "Template for creating new skills",
  "theme-factory": "Create and manage themes",
  "video-downloader": "Download and process videos",
  "competitive-ads-extractor": "Extract competitive advertising data",
  "domain-name-brainstormer": "Brainstorm domain names",
  "file-organizer": "Organize files and directories",
  "image-enhancer": "Enhance and edit images",
  "lead-research-assistant": "Research leads and contacts",
  "meeting-insights-analyzer": "Analyze meeting insights",
  "raffle-winner-picker": "Pick raffle winners randomly",

  // Obra Superpowers
  "agentic-workflow-guide": "Guide for agentic workflows",
  "test-driven-development": "Test-driven development (TDD)",
  "commit-mastery": "Master Git commits",
  "defensive-coding": "Defensive coding practices",
  "pr-optimization": "Optimize pull requests",
  "agent-requested-skill": "Agent-requested skill template",
  "agent-spec-writing": "Write agent specifications",

  // Context Engineering Skills
  "context-fundamentals": "Context engineering fundamentals",
  "context-optimization": "Optimize context usage",
  "context-compression": "Compress context efficiently",
  "context-degradation": "Handle context degradation",
  "memory-systems": "Memory system design",
  "multi-agent-patterns": "Multi-agent design patterns",
  "tool-design": "Design agent tools",
  evaluation: "Evaluate agent performance",
  "advanced-evaluation": "Advanced evaluation techniques",
  "project-development": "Project development workflow",
  "book-sft-pipeline": "Book SFT pipeline",
  "digital-brain-skill": "Digital brain and knowledge management",

  // PAI Packs
  analyze_answers: "Analyze answers and responses",
  analyze_claims: "Analyze claims for accuracy",
  analyze_debate: "Analyze debate arguments",
  analyze_email_headers: "Analyze email headers",
  analyze_interviewer: "Analyze interview techniques",
  analyze_logs: "Analyze log files",
  analyze_malware: "Analyze malware samples",
  analyze_military_activity: "Analyze military activity",
  analyze_paper: "Analyze research papers",
  analyze_patent: "Analyze patents",
  analyze_personality: "Analyze personality traits",
  analyze_presentation: "Analyze presentations",
  analyze_product_feedback: "Analyze product feedback",
  analyze_prose: "Analyze prose writing",
  analyze_prose_json: "Analyze prose with JSON output",
  analyze_prose_pinker: "Analyze prose (Pinker style)",
  analyze_sales_call: "Analyze sales calls",
  analyze_spiritual_text: "Analyze spiritual texts",
  analyze_threat_report: "Analyze threat reports",
  analyze_threat_report_trends: "Analyze threat report trends",
  coding_master: "Master coding practices",
  compare_and_contrast: "Compare and contrast topics",
  create_5_sentence_summary: "Create 5-sentence summaries",
  create_academic_paper: "Create academic papers",
  create_ai_jobs_analysis: "Analyze AI job market",
  create_aphorisms: "Create aphorisms and sayings",
  create_art_prompt: "Create art prompts",
  create_better_frame: "Create better mental frames",
  create_coding_project: "Create coding projects",
  create_command: "Create terminal commands",
  create_cyber_summary: "Create cybersecurity summaries",
  create_design_document: "Create design documents",
  create_diy: "Create DIY project guides",
  create_formal_email: "Create formal emails",
  create_git_diff_commit: "Create Git diff commits",
  create_graph_from_input: "Create graphs from input data",
  create_hormozi_offer: "Create Hormozi-style offers",
  create_idea_compass: "Create idea compasses",
  create_investigation_visualization: "Create investigation visualizations",
  create_keynote: "Create keynote presentations",
  create_logo: "Create logos",
  create_markmap_visualization: "Create Markmap visualizations",
  create_mermaid_visualization: "Create Mermaid diagrams",
  create_mermaid_visualization_for_github: "Create Mermaid diagrams for GitHub",
  create_micro_summary: "Create micro summaries",
  create_network_threat_landscape: "Create network threat landscapes",
  create_newsletter_entry: "Create newsletter entries",
  create_npc: "Create NPC characters",
  create_pattern: "Create design patterns",
  create_prd: "Create product requirement documents",
  create_quiz: "Create quizzes",
  create_reading_plan: "Create reading plans",
  create_recipe: "Create recipes",
  create_report_finding: "Create report findings",
  create_security_update: "Create security updates",
  create_show_intro: "Create show introductions",
  create_sigma_rules: "Create Sigma detection rules",
  create_story: "Create stories",
  create_stride_threat_model: "Create STRIDE threat models",
  create_summary: "Create summaries",
  create_tags: "Create content tags",
  create_threat_scenarios: "Create threat scenarios",
  create_ttrc_graph: "Create TTRC graphs",
  create_ttrc_narrative: "Create TTRC narratives",
  create_upgrade_pack: "Create upgrade packs",
  create_user_story: "Create user stories",
  create_video_chapters: "Create video chapters",
  create_visualization: "Create visualizations",
  create_wiki_article: "Create wiki articles",

  // Compound Engineering
  "claude-system-prompt": "Claude system prompt engineering",
  "compound-engineering": "Compound engineering practices",

  // PRPs Agentic
  "prp-agile-development-feature-planning":
    "Agile development feature planning",
  "prp-best-practices-and-patterns": "Best practices and patterns",
  "prp-code-documentation": "Code documentation",
  "prp-code-review-and-quality": "Code review and quality",
  "prp-creative-writing-and-worldbuilding":
    "Creative writing and worldbuilding",
  "prp-debugging-and-problem-solving": "Debugging and problem solving",
  "prp-git-commit-standards": "Git commit standards",
  "prp-learning-and-concept-explanations": "Learning and concept explanations",
  "prp-project-file-structure-analysis": "Project file structure analysis",
  "prp-research-and-information-synthesis":
    "Research and information synthesis",
  "prp-task-breakdown-and-planning": "Task breakdown and planning",
  "prp-tech-stack-and-tool-selection": "Tech stack and tool selection",
  "prp-testing-strategies": "Testing strategies",

  // Claude Command Suite
  "claude-command-build": "Claude command build",
  "claude-command-format": "Claude command format",
  "claude-command-help": "Claude command help",
  "claude-command-model": "Claude command model",
  "claude-command-rules": "Claude command rules",

  // GitHub Awesome Copilot
  "code-assistant": "Code assistant",
  "pr-reviewer": "Pull request reviewer",

  // ComposioHQ Awesome
  "article-summarizer": "Summarize articles",
  "code-refactoring": "Refactor code",
  "data-analyzer": "Analyze data",
  "database-analyzer": "Analyze databases",
  "document-generator": "Generate documents",
  "email-drafter": "Draft emails",
  "presentation-builder": "Build presentations",
  "spreadsheet-analyzer": "Analyze spreadsheets",
  summarizer: "Summarize content",
  "website-analyzer": "Analyze websites",
};

// スキルを更新
for (const skill of index.skills) {
  // 現在の description を description_ja に移動
  skill.description_ja = skill.description;

  // 英語の description を設定（マッピングにあれば使用、なければスキル名から生成）
  if (englishDescriptions[skill.name]) {
    skill.description = englishDescriptions[skill.name];
  } else {
    // スキル名をタイトルケースに変換して説明として使用
    const words = skill.name
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
    skill.description = words.join(" ");
  }
}

// ソースの description も同様に処理
for (const source of index.sources) {
  source.description_ja = source.description;
  // ソース名をそのまま英語説明として使用
  source.description = source.name;
}

// 保存
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8");
console.log(`Updated ${index.skills.length} skills with English descriptions`);
