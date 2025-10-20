import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

// According to AI SDK 5, tools use inputSchema not parameters
const weatherTool = {
  description: "Get weather for a city",
  inputSchema: z.object({
    city: z.string().describe("City name"),
  }),
  execute: async ({ city }: { city: string }) => {
    console.log(`  → Called weatherTool with city: ${city}`);
    return { temperature: 25, city };
  },
};

async function testModel(modelName: string) {
  console.log(`\nTesting ${modelName} with generateText...`);

  try {
    const result = await generateText({
      model: openai(modelName),
      tools: {
        getWeather: weatherTool,
      },
      maxTokens: 500,
      system: "You are a helpful assistant. Use tools when appropriate.",
      prompt: "What's the weather in New York?",
    });

    console.log(`  Text: ${result.text || "<empty>"}`);
    console.log(`  Tool calls: ${result.toolCalls?.length || 0}`);
    console.log(`  Tool results: ${result.toolResults?.length || 0}`);

    if (result.toolCalls && result.toolCalls.length > 0) {
      console.log("  ✅ Model called tools");
      console.log("  Tool names:", result.toolCalls.map((c: any) => c.toolName));
    } else {
      console.log("  ❌ Model did not call tools");
    }
  } catch (error: any) {
    console.log(`  ❌ Error: ${error.message}`);
    if (error.cause) {
      console.log(`  Cause:`, error.cause);
    }
  }
}

async function main() {
  const models = [
    "gpt-4o-mini",
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-nano",
  ];

  for (const model of models) {
    await testModel(model);
  }
}

main();
