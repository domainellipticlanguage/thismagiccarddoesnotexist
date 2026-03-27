export function AboutPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <h1 className="font-display text-3xl text-gold-400">About</h1>
      <p className="text-neutral-300 text-base leading-relaxed">
        <strong>This Magic Card Does Not Exist</strong> uses AI to design and render completely original
        Magic: The Gathering cards. Describe what you want, and the system generates a balanced card design,
        creates custom artwork, and renders a high-fidelity card image — all in seconds.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { title: "Card Design", desc: "LLM-powered card design using Groq/Cerebras with Llama models. Outputs cards in MTG text spoiler format." },
          { title: "Art Generation", desc: "AI art generation via Replicate. Each card gets unique, prompt-driven fantasy artwork." },
          { title: "Card Rendering", desc: "Pixel-perfect card rendering using mtg-crucible. Supports all card types: creatures, planeswalkers, sagas, and more." },
          { title: "Infrastructure", desc: "Deployed on AWS Lambda with Serverless Framework. DynamoDB for data, S3 for images." },
        ].map((item) => (
          <div key={item.title} className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gold-400 mb-1">{item.title}</h3>
            <p className="text-sm text-neutral-400">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
