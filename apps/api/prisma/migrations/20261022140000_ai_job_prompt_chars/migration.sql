-- Size of the prompts a job sent, to measure characters per token (docs/66)
ALTER TABLE "AiJob" ADD COLUMN "promptChars" INTEGER;
