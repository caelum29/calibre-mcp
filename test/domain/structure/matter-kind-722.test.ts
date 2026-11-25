// #722: index pages stored as body. pdftotext wraps index entries over several lines, so many
// lines end without a page locator and the old prose guard read the page as prose. Fixtures are
// literal chunks of book 888 (RAG With Python Cookbook, Programming_Books), version-5 offsets;
// its text is 565806 chars and its PDF outline has an "Index" section at 534331–563480.

import { describe, expect, it } from "vitest";
import { classifyChunk } from "../../../src/domain/structure/matter-kind.js";

const TEXT_LENGTH = 565_806;
const place = (charStart: number, heading: string) => ({ position: charStart / TEXT_LENGTH, inFront: false, heading });

// @541401: index entries wrapped over several lines ("hybrid search approach" / "combining …").
const INDEX_WRAPPED_541401 =
  '\fhybrid search approach\ncombining keyword and semantic\nsearch, 141\ndiscussion and when to use, 144-145\nreciprocal rank fusion implementation,\n143\nmapping text to numerical representation,\n118-123\nperforming text classification with, 137-141\nstoring and searching with FAISS, 151-155\nstoring in Chroma, 155-158\nstoring in PostgreSQL (pgvector), 159-164\ntext classification, 137-141\nentity extraction, 336, 338\n.env files, storing secrets and API keys, 10-12\nenvironment variables, 11-12\n"Essential GraphRAG" (Bratanič and Hane),\n283\nEuclidean distance, 130\nevaluating RAG systems\nchoosing evaluation metrics, 289-292\ncontext precision@k\ndiscussion and score interpretation,\n306-308\nLLM relevance verification code,\n303-306\nprecision formula and steps, 301\nhuman evaluation, 293-296\nLLM-as-a-judge for faithfulness\nclaim decomposition approach, 308\ndiscussion and Ragas source code, 315\nextracting claims from answers, 311\nverifying claims against context, 312-314\nresponse relevancy\ncosine similarity scoring, 320-321\ndiscussion and relevancy interpretation,\n322\nnoncommittal answer detection, 319\nreverse question generation method,\n316-318\nsynthetic data for testing, 296-301\nevaluation metrics, 289-292\nevaluator-optimizer (workflow pattern), 220\nExcel files, loading tabular data from, 52-56\nexpansions\ngraph expansion, 262\nquery expansion, 188\nextraction, data, 4\n\n354\n\n|\n\nIndex\n\nF\n\n';

// @548541: wrapped sub-entries across a page break.
const INDEX_WRAPPED_548541 =
  "query transform cookbook, 210\nquery transformations documentation, 99\nRAG examples repository, 18\nrouter query engine, 196\nsemantic chunker examples, 111\nsentence window retriever, 203\nSimpleDirectoryReader, 341\nSQL Query Engine, 347\nstarter example, 18\nLLM-as-a-judge\nevaluating faithfulness during generation,\n308-315\nevaluating metrics, 291-293\nrevealing retrieval noise, 307\nLLM-generated metadata, 86-87\nLLMs (large language models), 1\n\n\floading data\naudio files via speech-to-text, 59-60\nfrom PostgreSQL database, 57-58\nparsing PDFs, multimodal content, 73-76\nPDF files, 50-52\ntabular data from Excel/CSV, 52-57\ntext descriptions for images, 68-70\ntext extraction from images, 65-67\ntext summaries for embedded tables, 70-73\nvia Tesseract OCR, 61-64\nvideos via multimodal models\naudio transcription with Whisper, 81\ndiscussion and segmentation trade-offs,\n81\nframe extraction and processing, 79-81\nvideo partitioning strategy, 77-79\nWord files, 47-49\nlong-term memory (agent), 212\n\nM\n\n";

// @563479: the last chunk that starts in the Index section runs into "About the Author".
const ABOUT_THE_AUTHOR_563479 =
  "\fAbout the Author\nDominik Polzer is AI lead for procurement at Siemens Energy, where he leads transformative machine learning and agentic AI projects that will change how procurement departments work tomorrow.\nWith nearly a decade of experience deploying machine learning solutions in production, Dominik has built AI applications across diverse business functions—from\nmanufacturing and finance to procurement. His expertise spans the full lifecycle of\nindustrial AI systems, with a particular focus on retrieval-augmented generation\n(RAG) and foundation models in recent years.\nThrough his popular Medium blog, Dominik has reached millions of readers by\nexplaining RAG architectures, vector databases, and AI agent frameworks. You can\nconnect with him on LinkedIn.\n\nColophon\nThe animal on the cover of RAG with Python Cookbook is a striped keelback (Xenochrophis vittatus), a medium-sized snake native to western Indonesia. Females reach\nabout 70 cm in length, while males reach about 50 cm. They are yellow to brown with\nblack stripes running along the top and sides of the body.\nThe striped keelback is diurnal and primarily lives around moist lowlands or aquatic\nareas such as ponds and wetlands. Its diet consists of fish, amphibians, and lizards. It\nis mildly venomous but is considered harmless to humans.\nIt is considered a species of least concern and easily adapts to agricultural areas like\nrice paddies and fields. The striped keelback has also reportedly been introduced to\nSingapore and Puerto Rico. Many of the animals on O’Reilly covers are endangered;\nall of them are important to the world.\nThe cover illustration is by José Marzan Jr., based on an antique line engraving from\nLydekker’s Royal Natural History. The series design is by Edie Freedman, Ellie\nVolckhausen, and Karen Montgomery. The cover fonts are Gilroy Semibold and\nGuardian Sans. The text font is Adobe Minion Pro; the heading font is Adobe Myriad\nCondensed; and the code font is Dalton Maag’s Ubuntu Mono.\n\n";

// @490245: a body chapter past 0.85 whose text cites a page ("page 335") and carries page footers.
const BODY_PAGE_CITES_490245 =
  'np.linalg.norm(user_question_embedding)\n* np.linalg.norm(generated_question["embedding"])\n)\n\nFigure 10-19 shows the example structure of a generated question object with embedding and cosine similarity.\n\n320\n\n|\n\nChapter 10: Evaluating RAG Systems\n\n[image #209: page 335, "Figure 10-19. The structure of a generated question object with embedding and cosine"]\n\fFigure 10-19. The structure of a generated question object with embedding and cosine\nsimilarity\nThe final step uses the cosine similarity score of each question to calculate the overall\nresponse relevancy score. The logic penalizes evasive answers: if any generated question was rated as noncommittal (meaning the answer doesn’t provide useful information for that question), the overall score is set to 0. Otherwise, the score is the mean\ncosine similarity between all artificial questions and the user’s question. Here’s the\ncode:\n# Calculate the mean cosine similarity over all generated questions\ncosine_sim_mean = pd.DataFrame(generated_questions)["cosine_sim"].mean()\n# Check if any of the generated questions are noncommittal\nhas_noncommittal = any(pd.DataFrame(generated_questions)["noncommittal"])\n# If any generated question is noncommittal, set score to 0\n# This penalizes evasive answers that acknowledge but don\'t address questions\nresponse_relevance_score = cosine_sim_mean * int(not has_noncommittal)\n\n';

describe("index pages under an outline Index heading (#722)", () => {
  it("the wrapped-entry chunk at @541401 is back_index", () => {
    expect(classifyChunk(INDEX_WRAPPED_541401, place(541_401, "Index"))).toBe("back_index");
  });

  it("the wrapped sub-entry chunk at @548541 is back_index", () => {
    expect(classifyChunk(INDEX_WRAPPED_548541, place(548_541, "Index"))).toBe("back_index");
  });

  it("the About the Author chunk at @563479 stays body, though it starts in the Index section", () => {
    expect(classifyChunk(ABOUT_THE_AUTHOR_563479, place(563_479, "Index"))).toBe("body");
  });
});

describe("guards: unchanged behaviour (#722)", () => {
  it("a body chapter past 0.85 whose prose cites page numbers stays body", () => {
    expect(classifyChunk(BODY_PAGE_CITES_490245, place(490_245, "Chapter 10. Evaluating RAG Systems"))).toBe("body");
  });

  it("a chapter titled Indexes or Indexing stays body past 0.85", () => {
    expect([
      classifyChunk(BODY_PAGE_CITES_490245, place(490_245, "Indexes")),
      classifyChunk(BODY_PAGE_CITES_490245, place(490_245, "Indexing")),
    ]).toEqual(["body", "body"]);
  });
});
