import LineageSketch from './LineageSketch';

export default function LineageSketchPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-12">
      <div className="text-center mb-10">
        <h1 className="text-4xl font-extrabold text-zinc-900 mb-2">Lineage Sketch</h1>
        <p className="text-zinc-500 text-sm max-w-xl mx-auto">
          A throwaway sketch of what model lineage could look like as a graph. Hand-written fake
          data, not the database — the point is to find out what the interaction needs before
          deciding what the tables should hold.
        </p>
      </div>

      <LineageSketch />
    </div>
  );
}
