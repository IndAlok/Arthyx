import neo4j, { Driver, Session } from "neo4j-driver";

let driver: Driver | null = null;
let lastConnectionAttempt = 0;
const CONNECTION_RETRY_INTERVAL = 30000;

const log = (step: string, data?: object) => {
  console.log(`[NEO4J] ${step}`, data ? JSON.stringify(data) : "");
};

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isConfigured(): boolean {
  return !!(process.env.NEO4J_URI && process.env.NEO4J_USERNAME && process.env.NEO4J_PASSWORD);
}

export async function initializeDriver(): Promise<Driver | null> {
  if (!isConfigured()) {
    return null;
  }

  if (driver) {
    try {
      await driver.verifyConnectivity();
      return driver;
    } catch {
      log("Driver disconnected, reconnecting...");
      try { await driver.close(); } catch {}
      driver = null;
    }
  }

  const now = Date.now();
  if (now - lastConnectionAttempt < CONNECTION_RETRY_INTERVAL && lastConnectionAttempt > 0) {
    return null;
  }
  lastConnectionAttempt = now;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      log("Connecting", { attempt });
      driver = neo4j.driver(
        process.env.NEO4J_URI!,
        neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!),
        { 
          maxConnectionLifetime: 3 * 60 * 60 * 1000,
          maxConnectionPoolSize: 5,
          connectionAcquisitionTimeout: 30000,
        }
      );
      await driver.verifyConnectivity();
      log("Connected successfully");
      return driver;
    } catch (error) {
      log("Connection failed", { attempt, error: String(error).substring(0, 150) });
      driver = null;
      if (attempt < 3) await sleep(3000 * attempt);
    }
  }
  return null;
}

export async function getSession(): Promise<Session | null> {
  const d = await initializeDriver();
  if (!d) return null;
  return d.session();
}

export async function healthCheck(): Promise<{ status: string; connected: boolean; message: string }> {
  const session = await getSession();
  if (!session) {
    return { status: "error", connected: false, message: "Neo4j not configured or connection failed" };
  }
  try {
    await session.run("RETURN 1");
    return { status: "ok", connected: true, message: "Neo4j AuraDB connected" };
  } catch (error) {
    return { status: "error", connected: false, message: String(error) };
  } finally {
    await session.close();
  }
}

export interface Entity {
  type: "Company" | "Regulation" | "Amount" | "Date" | "Sector" | "Policy" | "Clause" | "company" | "regulation" | "person" | "amount" | "date" | "sector";
  name: string;
  properties?: Record<string, string | number>;
}

export interface Relationship {
  fromName: string;
  fromType: string;
  toName: string;
  toType: string;
  relationType: string;
  properties?: Record<string, string | number>;
}

export async function extractEntitiesFromText(
  text: string,
  sessionId: string
): Promise<{ entities: Entity[]; relationships: Relationship[] }> {
  const entities: Entity[] = [];
  const relationships: Relationship[] = [];

  const companyPatterns = [
    /\b(HDFC|ICICI|SBI|Axis|Kotak|Yes Bank|IndusInd|RBL|Bandhan|IDFC)\b/gi,
    /\b(Reliance|Tata|Infosys|TCS|Wipro|HCL|Bharti Airtel|ITC|L&T|Mahindra)\b/gi,
    /\b(Bajaj|Adani|JSW|Vedanta|Hindalco|ONGC|NTPC|Power Grid|Coal India)\b/gi,
    /\b(HDFC Bank|ICICI Bank|State Bank|Axis Bank|Kotak Mahindra)\b/gi,
    /([A-Z][a-zA-Z&]+)\s+(?:Ltd|Limited|Pvt|Private|Inc|Corp|Bank|Insurance)/g,
  ];

  const regulationPatterns = [
    /SEBI[\s/-]?(?:circular|guideline|regulation|act)?[\s/-]?\d{4}(?:\/\d+)?/gi,
    /RBI[\s/-]?(?:circular|guideline|regulation|master direction)?[\s/-]?\d{4}(?:\/\d+)?/gi,
    /(?:FEMA|PMLA|Companies Act|Banking Regulation Act|Insurance Act|Motor Vehicles Act)[\s,]?\d{4}/gi,
    /\b(IRDAI|IRDA|SEBI|RBI|PFRDA|IFSCA)\b/g,
    /Section\s+\d+(?:\s*\([a-z]\))?/gi,
  ];

  const policyPatterns = [
    /(?:Policy|Coverage|Insurance)\s+(?:No|Number|#)?\.?\s*:?\s*([A-Z0-9/-]+)/gi,
    /\b(Third Party|Comprehensive|Own Damage|Personal Accident)\s+(?:Cover|Policy|Insurance)/gi,
  ];

  const clausePatterns = [
    /\b(Exclusion|Exception|Condition|Endorsement|Rider)\s+(?:No|#)?\.?\s*\d*/gi,
    /(?:General|Special)\s+(?:Conditions?|Exceptions?|Exclusions?)/gi,
    /AVOIDANCE\s+OF\s+CERTAIN\s+TERMS/gi,
    /RIGHT\s+OF\s+RECOVERY/gi,
  ];

  const amountPatterns = [
    /(?:₹|INR|Rs\.?)\s*[\d,]+(?:\.\d+)?(?:\s*(?:crore|lakh|million|billion|lac)s?)?/gi,
    /\b\d+(?:,\d+)*(?:\.\d+)?\s*(?:crore|lakh|million|billion|lac)s?\b/gi,
  ];

  const addEntity = (type: Entity["type"], name: string, props?: Record<string, string | number>) => {
    const cleanName = name.trim().replace(/\s+/g, ' ');
    if (cleanName.length > 2 && cleanName.length < 80) {
      if (!entities.find(e => e.name === cleanName && e.type === type)) {
        entities.push({ type, name: cleanName, properties: props });
      }
    }
  };

  for (const pattern of companyPatterns) {
    for (const match of text.matchAll(pattern)) {
      addEntity("Company", match[1] || match[0]);
    }
  }

  for (const pattern of regulationPatterns) {
    for (const match of text.matchAll(pattern)) {
      addEntity("Regulation", match[0]);
    }
  }

  for (const pattern of policyPatterns) {
    for (const match of text.matchAll(pattern)) {
      addEntity("Policy", match[1] || match[0]);
    }
  }

  for (const pattern of clausePatterns) {
    for (const match of text.matchAll(pattern)) {
      addEntity("Clause", match[0]);
    }
  }

  for (const pattern of amountPatterns) {
    for (const match of text.matchAll(pattern)) {
      addEntity("Amount", match[0], { rawValue: match[0] });
    }
  }

  const companies = entities.filter(e => e.type === "Company");
  const regulations = entities.filter(e => e.type === "Regulation");
  const clauses = entities.filter(e => e.type === "Clause");
  const policies = entities.filter(e => e.type === "Policy");

  for (const company of companies) {
    for (const regulation of regulations) {
      relationships.push({
        fromName: company.name,
        fromType: "Company",
        toName: regulation.name,
        toType: "Regulation",
        relationType: "GOVERNED_BY",
      });
    }
  }

  for (const policy of policies) {
    for (const clause of clauses) {
      relationships.push({
        fromName: policy.name,
        fromType: "Policy",
        toName: clause.name,
        toType: "Clause",
        relationType: "CONTAINS",
      });
    }
    for (const regulation of regulations) {
      relationships.push({
        fromName: policy.name,
        fromType: "Policy",
        toName: regulation.name,
        toType: "Regulation",
        relationType: "SUBJECT_TO",
      });
    }
  }

  await saveToNeo4j(sessionId, entities.slice(0, 100), relationships.slice(0, 50));

  return { entities, relationships };
}

async function saveToNeo4j(
  sessionId: string,
  entities: Entity[],
  relationships: Relationship[]
): Promise<void> {
  const session = await getSession();
  if (!session) {
    log("Skipping Neo4j save - not connected");
    return;
  }

  try {
    log("Saving to Neo4j", { entities: entities.length, relationships: relationships.length });

    const createEntitiesQuery = `
      UNWIND $entities AS entity
      CALL apoc.merge.node([entity.type], {name: entity.name, sessionId: $sessionId}, entity.props) YIELD node
      RETURN count(node) as created
    `;

    const createEntitiesQueryFallback = `
      UNWIND $entities AS entity
      MERGE (n {name: entity.name, sessionId: $sessionId})
      SET n += entity.props, n:Entity
      RETURN count(n) as created
    `;

    const entityData = entities.map(e => ({
      type: e.type,
      name: e.name,
      props: { ...e.properties, createdAt: Date.now() }
    }));

    try {
      await session.run(createEntitiesQuery, { entities: entityData, sessionId });
    } catch {
      await session.run(createEntitiesQueryFallback, { entities: entityData, sessionId });
    }

    log("Entities saved", { count: entities.length });

    for (const rel of relationships) {
      try {
        await session.run(`
          MATCH (a {name: $fromName, sessionId: $sessionId})
          MATCH (b {name: $toName, sessionId: $sessionId})
          MERGE (a)-[r:${rel.relationType}]->(b)
          SET r.createdAt = $timestamp
        `, {
          fromName: rel.fromName,
          toName: rel.toName,
          sessionId,
          timestamp: Date.now(),
        });
      } catch (relError) {
        log("Relationship creation failed", { from: rel.fromName, to: rel.toName, error: String(relError).substring(0, 50) });
      }
    }

    log("Relationships saved", { count: relationships.length });

  } catch (error) {
    log("Neo4j save error", { error: String(error).substring(0, 200) });
  } finally {
    await session.close();
  }
}

export async function getSessionGraph(sessionId: string): Promise<{
  nodes: Array<{ id: string; type: string; properties?: Record<string, unknown> }>;
  edges: Array<{ from: string; to: string; type: string }>;
}> {
  const session = await getSession();
  if (!session) return { nodes: [], edges: [] };
  
  try {
    const result = await session.run(`
      MATCH (n {sessionId: $sessionId})
      OPTIONAL MATCH (n)-[r]->(m {sessionId: $sessionId})
      WITH collect(distinct n) as nodes, collect(distinct {from: n.name, to: m.name, type: type(r)}) as rels
      RETURN 
        [n IN nodes | {id: n.name, type: labels(n)[0], properties: properties(n)}] as nodes,
        [r IN rels WHERE r.to IS NOT NULL | r] as edges
    `, { sessionId });

    const record = result.records[0];
    return {
      nodes: record?.get("nodes") || [],
      edges: record?.get("edges") || [],
    };
  } finally {
    await session.close();
  }
}

export async function queryRelatedEntities(
  sessionId: string,
  entityName: string,
  depth: number = 2
): Promise<{ paths: Array<{ nodes: string[]; relationships: string[] }> }> {
  const session = await getSession();
  if (!session) return { paths: [] };
  
  try {
    const result = await session.run(`
      MATCH path = (start {name: $name, sessionId: $sessionId})-[*1..${depth}]-(connected)
      RETURN 
        [node in nodes(path) | node.name] as nodes,
        [rel in relationships(path) | type(rel)] as relationships
      LIMIT 20
    `, { name: entityName, sessionId });

    return {
      paths: result.records.map(r => ({
        nodes: r.get("nodes"),
        relationships: r.get("relationships"),
      })),
    };
  } finally {
    await session.close();
  }
}

export async function clearSessionGraph(sessionId: string): Promise<void> {
  const session = await getSession();
  if (!session) return;
  
  try {
    await session.run(`MATCH (n {sessionId: $sessionId}) DETACH DELETE n`, { sessionId });
    log("Session graph cleared", { sessionId });
  } finally {
    await session.close();
  }
}

export async function getGraphStats(sessionId: string): Promise<{
  nodeCount: number;
  relationshipCount: number;
  nodeTypes: Record<string, number>;
}> {
  const session = await getSession();
  if (!session) return { nodeCount: 0, relationshipCount: 0, nodeTypes: {} };
  
  try {
    const result = await session.run(`
      MATCH (n {sessionId: $sessionId})
      OPTIONAL MATCH (n)-[r]->(m {sessionId: $sessionId})
      WITH labels(n)[0] as nodeType, count(distinct n) as nodeCount, count(distinct r) as relCount
      RETURN collect({type: nodeType, count: nodeCount}) as nodeTypes, sum(relCount) as totalRels
    `, { sessionId });

    const record = result.records[0];
    const nodeTypes: Record<string, number> = {};
    let totalNodes = 0;
    
    for (const nt of record?.get("nodeTypes") || []) {
      if (nt.type) {
        nodeTypes[nt.type] = nt.count.toNumber ? nt.count.toNumber() : nt.count;
        totalNodes += nodeTypes[nt.type];
      }
    }

    return {
      nodeCount: totalNodes,
      relationshipCount: record?.get("totalRels")?.toNumber?.() || record?.get("totalRels") || 0,
      nodeTypes,
    };
  } finally {
    await session.close();
  }
}

export async function queryRiskContagion(
  sessionId: string,
  startEntity: string,
  depth: number = 2
): Promise<{ path: string[]; relationships: string[] }[]> {
  const session = await getSession();
  if (!session) return [];
  try {
    const result = await session.run(`
      MATCH path = (start {name: $name, sessionId: $sessionId})-[*1..${depth}]-(connected)
      RETURN [node in nodes(path) | node.name] as path,
             [rel in relationships(path) | type(rel)] as rels
      LIMIT 10
    `, { name: startEntity, sessionId });

    return result.records.map(record => ({
      path: record.get("path"),
      relationships: record.get("rels"),
    }));
  } finally {
    await session.close();
  }
}
