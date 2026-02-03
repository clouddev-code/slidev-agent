# Slidev Agent

AI-powered Slidev presentation generator using Amazon Bedrock AgentCore and Strands Agents.

## Features

- Automatic web research on any topic using Tavily API
- Generates Slidev-compatible Markdown presentations
- Multiple presentation styles (technical, business, educational, pitch)
- Deployable to AgentCore Runtime for serverless operation

## Requirements

- Python 3.13+
- AWS credentials configured for Bedrock access
- Tavily API key

## Installation

```bash
# Clone the repository
git clone https://github.com/your-repo/slidev-agent.git
cd slidev-agent

# Install dependencies using uv
uv sync

# Copy and configure environment variables
cp .env.example .env
# Edit .env with your TAVILY_API_KEY
```

## Usage

### CLI

```bash
# Basic usage
slidev-agent "Amazon Bedrock AgentCoreの概要"

# With options
slidev-agent "Kubernetes入門" \
    --num-slides 15 \
    --style educational \
    --theme seriph \
    --output ./output/k8s.md

# All options
slidev-agent "トピック" \
    --num-slides 10 \
    --style technical \
    --theme default \
    --language ja \
    --output ./output/slides.md
```

### Options

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--num-slides` | `-n` | 10 | Target number of slides |
| `--style` | `-s` | technical | Style (technical/business/educational/pitch) |
| `--theme` | `-t` | default | Slidev theme |
| `--language` | `-l` | ja | Output language |
| `--output` | `-o` | ./output/slides.md | Output file path |

### Preview with Slidev

After generating a presentation:

```bash
# Install Slidev globally (if not installed)
npm install -g @slidev/cli

# Preview the generated presentation
slidev output/slides.md

# Or export to PDF
slidev export output/slides.md
```

## AgentCore Deployment

### Prerequisites

1. AWS CLI configured with appropriate permissions
2. AgentCore CLI installed

### Deploy

```bash
# Register Tavily API key as secret
aws secretsmanager create-secret \
    --name slidev-agent/TAVILY_API_KEY \
    --secret-string "your-tavily-api-key"

# Local development
agentcore dev

# Deploy to AWS
agentcore launch

# Check status
agentcore status
```

### Invoke (after deployment)

```python
import boto3

client = boto3.client('bedrock-agentcore')

response = client.invoke_agent_runtime(
    agentRuntimeArn="arn:aws:bedrock-agentcore:us-east-1:123456789:agent/slidev-agent",
    runtimeSessionId="session-123",
    payload={
        "topic": "Amazon Bedrock概要",
        "num_slides": 10,
        "theme": "seriph"
    }
)

print(response['result'])
```

## Project Structure

```
slidev-agent/
├── pyproject.toml          # Project configuration
├── agentcore.yaml          # AgentCore deployment config
├── .env.example            # Environment template
├── README.md
├── src/
│   └── slidev_agent/
│       ├── __init__.py
│       ├── main.py         # CLI entry point
│       ├── agent.py        # Strands Agent configuration
│       ├── runtime.py      # AgentCore Runtime handler
│       ├── tools/
│       │   ├── __init__.py
│       │   ├── search.py   # web_search, web_extract
│       │   └── writer.py   # write_slidev_markdown
│       └── prompts/
│           ├── __init__.py
│           └── system.py   # System prompt
├── tests/
│   └── test_tools.py
└── output/
    └── .gitkeep
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TAVILY_API_KEY` | Yes | Tavily API key for web search |
| `AWS_REGION` | No | AWS region (default: us-east-1) |
| `BEDROCK_MODEL_ID` | No | Bedrock model ID (default: Claude Sonnet) |

## License

MIT
