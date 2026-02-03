"""CLI entry point for Slidev Agent."""

import argparse
import sys
from typing import Literal

from dotenv import load_dotenv
from rich.console import Console
from rich.panel import Panel

from .agent import SlidevAgentConfig, run_slidev_agent

console = Console()


def parse_args() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Generate Slidev presentations using AI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  slidev-agent "Amazon Bedrock AgentCoreの概要"
  slidev-agent "Kubernetes入門" --num-slides 15 --style educational
  slidev-agent "AI戦略2024" --style business --theme seriph --output ./slides.md
        """,
    )

    parser.add_argument(
        "topic",
        type=str,
        help="Presentation topic",
    )
    parser.add_argument(
        "--num-slides",
        "-n",
        type=int,
        default=10,
        help="Target number of slides (default: 10)",
    )
    parser.add_argument(
        "--style",
        "-s",
        type=str,
        choices=["technical", "business", "educational", "pitch"],
        default="technical",
        help="Presentation style (default: technical)",
    )
    parser.add_argument(
        "--theme",
        "-t",
        type=str,
        default="default",
        help="Slidev theme (default: default)",
    )
    parser.add_argument(
        "--language",
        "-l",
        type=str,
        default="ja",
        help="Output language (default: ja)",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=str,
        default="./output/slides.md",
        help="Output file path (default: ./output/slides.md)",
    )

    return parser.parse_args()


def main() -> int:
    """Main entry point for CLI."""
    # Load environment variables from .env file
    load_dotenv()

    args = parse_args()

    console.print(
        Panel.fit(
            f"[bold blue]Slidev Agent[/bold blue]\n"
            f"Topic: {args.topic}\n"
            f"Slides: {args.num_slides} | Style: {args.style} | Theme: {args.theme}",
            title="Starting",
        )
    )

    config = SlidevAgentConfig(
        topic=args.topic,
        num_slides=args.num_slides,
        style=args.style,  # type: ignore[arg-type]
        theme=args.theme,
        language=args.language,
        output_path=args.output,
    )

    try:
        with console.status("[bold green]Generating presentation..."):
            result = run_slidev_agent(config)

        console.print("\n[bold green]Generation complete![/bold green]")
        console.print(f"\nOutput saved to: [cyan]{args.output}[/cyan]")

        # Print summary
        console.print(
            Panel(
                result[:500] + "..." if len(result) > 500 else result,
                title="Agent Response Summary",
                border_style="green",
            )
        )

        return 0

    except KeyboardInterrupt:
        console.print("\n[yellow]Cancelled by user[/yellow]")
        return 130
    except Exception as e:
        console.print(f"\n[bold red]Error:[/bold red] {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
