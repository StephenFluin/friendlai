import { Ollama } from 'ollama';

const ai = new Ollama({});

const analyze = async () => {
  const prompt = 'Tell me about the creation of the internet';
  const model = 'deepseek-r1:1.5b';
  console.log(`Using ${model} to analyze ${prompt}`);
  const results = await ai.generate({ model, prompt, options: {}, stream: false });
  console.log('AI generation done', results);
};
run();
