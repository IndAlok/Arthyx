import neo4j, { Driver, Session } from "neo4j-driver";

let driver: Driver | null = null;

const log = (step: string, data?: object) => {
  console.log(`[NEO4J] ${step}`, data ? JSON.stringify(data) : "");
};

export function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(
      process.env.NEO4J_URI!,
      neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!)
    );
  }
  return driver;
}

export async function getSession(): Promise<Session> {
  return getDriver().session();
}

export interface Entity {
  type: "company" | "regulation" | "person" | "amount" | "date" | "sector";
  name: string;
  properties?: Record<string, string | number>;
}

export interface Relationship {
  from: string;
  to: string;
  type: string;
  properties?: Record<string, string | number>;
}

export async function createEntity(
  sessionId: string,
  entity: Entity
): Promise<void> {
  const session = await getSession();
  try {
    log("Creating entity", { sessionId, entity: entity.name, type: entity.type });
    await session.run(
      `MERGE (e:${entity.type} {name: $name, sessionId: $sessionId})
       SET e += $props`,
      {
        name: entity.name,
        sessionId,
        props: entity.properties || {},
      }
    );
  } finally {
    await session.close();
  }
}

export async function createRelationship(
  sessionId: string,
  relationship: Relationship
): Promise<void> {
  const session = await getSession();
  try {
    log("Creating relationship", { 
      from: relationship.from, 
      to: relationship.to, 
      type: relationship.type 
    });
    await session.run(
      `MATCH (a {name: $from, sessionId: $sessionId})
       MATCH (b {name: $to, sessionId: $sessionId})
       MERGE (a)-[r:${relationship.type}]->(b)
       SET r += $props`,
      {
        from: relationship.from,
        to: relationship.to,
        sessionId,
        props: relationship.properties || {},
      }
    );
  } finally {
    await session.close();
  }
}

export async function extractEntitiesFromText(
  text: string,
  sessionId: string
): Promise<{ entities: Entity[]; relationships: Relationship[] }> {
  const entities: Entity[] = [];
  const relationships: Relationship[] = [];

  const companyPatterns = [
    /(?:M\/s\.?|Ltd\.?|Limited|Pvt\.?|Private|Inc\.?|Corp\.?)\s+([A-Z][a-zA-Z\s&]+)/g,
    /([A-Z][a-zA-Z\s&]+)\s+(?:Ltd\.?|Limited|Pvt\.?|Private|Inc\.?|Corp\.?)/g,
    /\b(HDFC|ICICI|SBI|Axis|Kotak|Yes Bank|IndusInd|RBL|Bandhan|IDFC)\b/gi,
    /\b(Reliance|Tata|Infosys|TCS|Wipro|HCL|Bharti|ITC|L&T|Mahindra)\b/gi,
  ];

  const regulationPatterns = [
    /SEBI[\s\/\-]?(?:circular|guideline|regulation|act)?[\s\/\-]?\d{4}(?:\/\d+)?/gi,
    /RBI[\s\/\-]?(?:circular|guideline|regulation|master direction)?[\s\/\-]?\d{4}(?:\/\d+)?/gi,
    /(?:FEMA|PMLA|Companies Act|Banking Regulation Act)[\s,]?\d{4}/gi,
    /\bIFSCA\b|\bIRDA\b|\bPFRDA\b/gi,
  ];

  const amountPatterns = [
    /(?:₹|INR|Rs\.?)\s*[\d,]+(?:\.\d+)?(?:\s*(?:crore|lakh|million|billion))?/gi,
    /\b\d+(?:\.\d+)?\s*(?:crore|lakh|million|billion)\b/gi,
  ];

  for (const pattern of companyPatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const name = (match[1] || match[0]).trim();
      if (name.length > 2 && name.length < 50) {
        entities.push({ type: "company", name });
      }
    }
  }

  for (const pattern of regulationPatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      entities.push({ type: "regulation", name: match[0].trim() });
    }
  }

  for (const pattern of amountPatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      entities.push({ 
        type: "amount", 
        name: match[0].trim(),
        properties: { value: match[0].trim() }
      });
    }
  }

  const uniqueEntities = entities.reduce((acc: Entity[], curr) => {
    if (!acc.find(e => e.name === curr.name && e.type === curr.type)) {
      acc.push(curr);
    }
    return acc;
  }, []);

  const companies = uniqueEntities.filter(e => e.type === "company");
  const regulations = uniqueEntities.filter(e => e.type === "regulation");

  for (const company of companies) {
    for (const regulation of regulations) {
      relationships.push({
        from: company.name,
        to: regulation.name,
        type: "REGULATED_BY",
      });
    }
  }

  const session = await getSession();
  try {
    for (const entity of uniqueEntities.slice(0, 20)) {
      await createEntity(sessionId, entity);
    }
    for (const rel of relationships.slice(0, 10)) {
      await createRelationship(sessionId, rel);
    }
    log("Entities extracted", { 
      entities: uniqueEntities.length, 
      relationships: relationships.length 
    });
  } finally {
    await session.close();
  }

  return { entities: uniqueEntities, relationships };
}

export async function queryRiskContagion(
  sessionId: string,
  startEntity: string,
  depth: number = 2
): Promise<{ path: string[]; relationships: string[] }[]> {
  const session = await getSession();
  try {
    log("Querying risk contagion", { startEntity, depth });
    const result = await session.run(
      `MATCH path = (start {name: $name, sessionId: $sessionId})-[*1..${depth}]-(connected)
       RETURN [node in nodes(path) | node.name] as path,
              [rel in relationships(path) | type(rel)] as rels
       LIMIT 10`,
      { name: startEntity, sessionId }
    );

    return result.records.map(record => ({
      path: record.get("path"),
      relationships: record.get("rels"),
    }));
  } finally {
    await session.close();
  }
}

export async function getSessionGraph(sessionId: string): Promise<{
  nodes: Array<{ id: string; type: string }>;
  edges: Array<{ from: string; to: string; type: string }>;
}> {
  const session = await getSession();
  try {
    log("Getting session graph", { sessionId });
    const result = await session.run(
      `MATCH (n {sessionId: $sessionId})
       OPTIONAL MATCH (n)-[r]->(m {sessionId: $sessionId})
       RETURN collect(distinct {id: n.name, type: labels(n)[0]}) as nodes,
              collect(distinct {from: n.name, to: m.name, type: type(r)}) as edges`,
      { sessionId }
    );

    const record = result.records[0];
    return {
      nodes: record?.get("nodes") || [],
      edges: (record?.get("edges") || []).filter((e: { to: string | null }) => e.to !== null),
    };
  } finally {
    await session.close();
  }
}

export async function clearSessionGraph(sessionId: string): Promise<void> {
  const session = await getSession();
  try {
    log("Clearing session graph", { sessionId });
    await session.run(
      `MATCH (n {sessionId: $sessionId}) DETACH DELETE n`,
      { sessionId }
    );
  } finally {
    await session.close();
  }
}
