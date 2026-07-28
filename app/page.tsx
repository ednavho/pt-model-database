import Link from 'next/link';

function DatabaseIcon() {
  return (
    <svg width="120" height="120" viewBox="0 0 239 239" fill="none">
      <path
        d="M215.1 65.725C215.1 85.5244 172.298 101.575 119.5 101.575C66.7015 101.575 23.8999 85.5244 23.8999 65.725M215.1 65.725C215.1 45.9256 172.298 29.875 119.5 29.875C66.7015 29.875 23.8999 45.9256 23.8999 65.725M215.1 65.725V173.275C215.1 193.074 172.298 209.125 119.5 209.125C66.7015 209.125 23.8999 193.074 23.8999 173.275V65.725M215.1 119.5C215.1 139.299 172.298 155.35 119.5 155.35C66.7015 155.35 23.8999 139.299 23.8999 119.5"
        stroke="#000000"
        strokeWidth="2"
      />
    </svg>
  );
}

function WorkflowIcon() {
  return (
    <svg width="120" height="120" viewBox="0 0 239 239" fill="none">
      <path
        d="M95.5999 149.375L65.7249 119.5L95.5999 89.625M143.4 89.625L173.275 119.5L143.4 149.375M47.7999 215.1C34.6003 215.1 23.8999 204.4 23.8999 191.2V47.8C23.8999 34.6004 34.6003 23.9 47.7999 23.9H191.2C204.399 23.9 215.1 34.6004 215.1 47.8V191.2C215.1 204.4 204.399 215.1 191.2 215.1H47.7999Z"
        stroke="#000000"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg width="120" height="120" viewBox="0 0 239 239" fill="none">
      <path
        d="M47.7999 215.101H191.2C204.399 215.101 215.1 203.838 215.1 189.943V49.0591C215.1 35.1647 204.399 23.9012 191.2 23.9012H47.7999C34.6003 23.9012 23.8999 35.1647 23.8999 49.059V189.943C23.8999 203.838 34.6003 215.101 47.7999 215.101Z"
        stroke="#000000"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M59.7499 155.35H179.25L139.417 85.6417L109.542 130.454L89.6249 110.538L59.7499 155.35Z"
        stroke="#000000"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const cards = [
  {
    href: '/models',
    title: 'Model Database',
    description: 'Checked models, ready to use in a ComfyUI workflow.',
    icon: <DatabaseIcon />,
  },
  {
    href: '/package-workflow',
    title: 'Workflow Converter',
    description: 'Turn your ComfyUI workflow into a Pseudorandom workflow, ready for Rhino.',
    icon: <WorkflowIcon />,
  },
  {
    href: '/image-info',
    title: 'Image Inspector',
    description: 'Drop in an image. See its model lineage and environmental impact.',
    icon: <ImageIcon />,
  },
];

export default function Home() {
  return (
    <div className="px-6 pt-[72px] pb-6">
      <div className="mb-[108px]">
        <p className="text-[15px] font-normal mb-2" style={{ color: '#878787' }}>
          Create your own workflow
        </p>
        <h1 className="text-[42px] font-bold leading-none tracking-tight text-black">
          Pseudorandom Toolkit
        </h1>
      </div>

      <div className="grid grid-cols-3 gap-[98px] px-[108px]">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group flex flex-col rounded-lg overflow-hidden border border-[#dfdfdf] hover:border-black transition-colors duration-300 ease-in-out no-underline"
          >
            <div className="flex-1 flex items-center justify-center py-16 px-8">
              {card.icon}
            </div>
            <div className="px-8 pb-16">
              <h2 className="font-normal leading-tight text-black" style={{ fontSize: '24px' }}>
                {card.title}
              </h2>
              <p className="font-normal leading-snug mt-1.5" style={{ fontSize: '15px', color: '#939393' }}>
                {card.description}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
