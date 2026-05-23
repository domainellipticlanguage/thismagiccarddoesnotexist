const CRUCIBLE_LOGO = "https://raw.githubusercontent.com/domainellipticlanguage/mtg-crucible/main/logo/logo-256.png";

export function AboutPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <h1 className="font-display text-3xl text-gold-400">About</h1>
      <p className="text-neutral-300 text-base leading-relaxed">
        <strong>This Magic Card Does Not Exist</strong> uses AI to design and render completely
        original Magic: The Gathering cards. Describe what you want, and the system generates a
        balanced card design, creates custom artwork, and renders a high-fidelity card image —
        all in about 5 seconds.
      </p>

      <div className="bg-gradient-to-br from-neutral-900 to-neutral-950 border border-gold-400/30 rounded-lg p-6">
        <div className="flex items-start gap-4">
          <img src={CRUCIBLE_LOGO} alt="mtg-crucible logo" className="h-24 w-auto shrink-0" />
          <div className="space-y-2">
            <div>
              <a
                href="https://www.npmjs.com/package/mtg-crucible"
                target="_blank"
                rel="noreferrer"
                className="font-display text-2xl text-gold-400 hover:text-gold-300 transition-colors"
              >
                mtg-crucible
              </a>
              <p className="text-xs text-neutral-500">The rendering engine that powers this site</p>
            </div>
            <p className="text-sm text-neutral-300 leading-relaxed">
              An open-source TypeScript library for rendering Magic: The Gathering card images.
              Supports every major frame: standard, planeswalker, saga, class, battle, transform,
              MDFC, split, fuse, flip, aftermath, mutate, prototype, leveler — plus snow, devoid,
              and nyx borders. Built alongside this site.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs pt-1">
              <span className="text-neutral-500">
                GitHub:{" "}
                <a
                  href="https://github.com/domainellipticlanguage/mtg-crucible"
                  target="_blank"
                  rel="noreferrer"
                  className="text-gold-400 hover:text-gold-300 underline underline-offset-2"
                >
                  domainellipticlanguage/mtg-crucible
                </a>
              </span>
              <span className="text-neutral-500">
                npm:{" "}
                <a
                  href="https://www.npmjs.com/package/mtg-crucible"
                  target="_blank"
                  rel="noreferrer"
                  className="text-gold-400 hover:text-gold-300 underline underline-offset-2"
                >
                  mtg-crucible
                </a>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="font-display text-xl text-gold-400">Source</h2>
        <p className="text-sm text-neutral-400">
          Code for this site is open source on GitHub:{" "}
          <a
            href="https://github.com/domainellipticlanguage/thismagiccarddoesnotexist"
            target="_blank"
            rel="noreferrer"
            className="text-gold-400 hover:text-gold-300 underline underline-offset-2"
          >
            domainellipticlanguage/thismagiccarddoesnotexist
          </a>
          .
        </p>
      </div>

      <div className="space-y-3">
        <h2 className="font-display text-xl text-gold-400">Contact</h2>
        <p className="text-sm text-neutral-400">
          Questions, feedback, or bug reports:{" "}
          <a
            href="mailto:domainellipticlanguage@gmail.com"
            className="text-gold-400 hover:text-gold-300 underline underline-offset-2"
          >
            domainellipticlanguage@gmail.com
          </a>
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { title: "Card Design", body: <>An LLM (Groq's openai/gpt-oss-120b by default) drafts the card using a structured-output schema, including multi-face layouts like transform, MDFC, split, saga, class, and battle.</> },
          { title: "Art Generation", body: <>Replicate's prunaai/p-image generates each face's artwork from a prompt; p-image-edit handles fine-grained edits and art-swap between linked faces.</> },
        ].map((item) => (
          <div key={item.title} className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gold-400 mb-1">{item.title}</h3>
            <p className="text-sm text-neutral-400">{item.body}</p>
          </div>
        ))}
      </div>

      <div className="text-xs text-neutral-500 pt-6 border-t border-neutral-900">
        Magic: The Gathering is a trademark of Wizards of the Coast. This site is a fan project
        and is not affiliated with or endorsed by Wizards of the Coast. Generated cards are not
        legal for any sanctioned play.
      </div>
    </div>
  );
}
