import WorkflowWizard from './WorkflowWizard';

export default function PackageWorkflowPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-12">
      <div className="text-center mb-10">
        <h1 className="text-4xl font-extrabold text-zinc-900 mb-2">Package Workflow</h1>
        <p className="text-zinc-500 text-sm max-w-xl mx-auto">
          Convert a raw ComfyUI workflow export into a Pseudorandom-ready workflow file with
          provenance attached.
        </p>
      </div>

      <WorkflowWizard />
    </div>
  );
}
