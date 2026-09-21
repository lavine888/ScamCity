package com.baytech.scamcity.bridge;

import java.util.ArrayList;
import java.util.List;

/**
 * Resolves which ScamCity endpoint the bridge should talk to.
 *
 * <p>Motivation, from a real failure: the bridge used to hardcode
 * {@code http://localhost:3000/api/simulation}. Minecraft's own "Open to LAN"
 * hands its LAN server whatever port is free and on 2026-09-20 that was 3000,
 * so the bridge connected to Minecraft and reported
 * {@code HTTP/1.1 header parser received no bytes} — the same message as an
 * unrelated HTTP/2 bug from the day before, which made it easy to misdiagnose.
 * Meanwhile the Next.js server had moved itself to 51662.</p>
 *
 * <p>Two defences, because guessing a port is not possible (Next picks a random
 * high port when 3000 is taken):</p>
 * <ol>
 *   <li><b>Discovery file.</b> {@code scripts/scamcity-serve.mjs} writes the URL
 *       it actually bound to into {@code <tmpdir>/scamcity-endpoint.json}. Both
 *       processes are on one machine, so the port stops being a guess. The
 *       launcher GUI does not inherit shell environment variables, which is why
 *       {@code SCAMCITY_API} alone was never enough.</li>
 *   <li><b>Identity check.</b> {@link #SCHEMA_VERSION} must appear in the
 *       response. Reaching <em>something</em> on a port is not evidence of
 *       reaching ScamCity, and saying so precisely is what turns this class of
 *       failure into a one-line diagnosis.</li>
 * </ol>
 *
 * <p>Security boundary: the discovery file lives in a shared temp directory, so
 * it is treated as untrusted input. Only loopback {@code http://} URLs are
 * accepted — a hostile file must not be able to point the bridge at a remote
 * host. Dependency-free on purpose so the Gradle verification source set can
 * exercise it without Minecraft on the classpath.</p>
 */
final class ApiEndpoints {
    /** Used when nothing is configured and no discovery file exists. */
    static final String DEFAULT_URL = "http://localhost:3000/api/simulation";
    /** Agreed with {@code scripts/scamcity-serve.mjs}; resolved under the JVM temp dir. */
    static final String DISCOVERY_FILE = "scamcity-endpoint.json";
    /** Must match {@code SIMULATION_API_SCHEMA} in {@code lib/simulation-api.ts}. */
    static final String SCHEMA_VERSION = "scamcity.simulation/v1";
    private static final String API_PATH = "/api/simulation";

    private ApiEndpoints() {
    }

    /**
     * Ordered endpoints to try.
     *
     * <p>An explicit setting is returned <em>alone</em>: the operator named a
     * port, so quietly succeeding against a different one would hide their
     * mistake. Otherwise the discovered endpoint is preferred over the default,
     * since the default is exactly the port Minecraft tends to steal.</p>
     */
    static List<String> candidates(String explicit, String discoveryFileContent) {
        String configured = normalise(explicit);
        if (!configured.isEmpty()) {
            return List.of(configured);
        }
        List<String> ordered = new ArrayList<>(2);
        String discovered = readDiscovered(discoveryFileContent);
        if (!discovered.isEmpty()) {
            ordered.add(discovered);
        }
        if (!ordered.contains(DEFAULT_URL)) {
            ordered.add(DEFAULT_URL);
        }
        return List.copyOf(ordered);
    }

    /** Extract and vet the {@code url} field; returns "" when unusable. */
    static String readDiscovered(String discoveryFileContent) {
        if (discoveryFileContent == null || discoveryFileContent.isBlank()) {
            return "";
        }
        return normalise(stringField(discoveryFileContent, "url"));
    }

    /**
     * Canonicalise a configured or discovered URL, rejecting anything that is
     * not loopback HTTP. A bare origin is completed with the API path so both
     * {@code http://localhost:51662} and the full URL work.
     */
    static String normalise(String url) {
        if (url == null) {
            return "";
        }
        String trimmed = url.trim();
        if (!isLoopbackHttp(trimmed)) {
            return "";
        }
        while (trimmed.endsWith("/")) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
        }
        int pathStart = trimmed.indexOf('/', "http://".length());
        if (pathStart < 0) {
            return trimmed + API_PATH;
        }
        return trimmed;
    }

    /**
     * Plaintext HTTP to this machine only.
     *
     * <p>The check is on the literal host so it cannot be tricked by a name
     * that merely resolves to loopback, and credentials in the authority are
     * refused rather than parsed.</p>
     */
    static boolean isLoopbackHttp(String url) {
        if (url == null || !url.startsWith("http://")) {
            return false;
        }
        String rest = url.substring("http://".length());
        int pathStart = rest.indexOf('/');
        String authority = pathStart < 0 ? rest : rest.substring(0, pathStart);
        if (authority.indexOf('@') >= 0) {
            return false;
        }
        String host = authority;
        int port = authority.lastIndexOf(':');
        if (port >= 0) {
            String digits = authority.substring(port + 1);
            if (digits.isEmpty() || !digits.chars().allMatch(Character::isDigit)) {
                return false;
            }
            host = authority.substring(0, port);
        }
        return host.equals("localhost") || host.equals("127.0.0.1") || host.equals("[::1]");
    }

    /**
     * Whether a response body really came from ScamCity.
     *
     * <p>Deliberately a substring test on the raw body: it must also reject the
     * case where the JSON parsed fine but came from an unrelated service, and
     * it costs nothing before handing the body to a parser.</p>
     */
    static boolean looksLikeSnapshot(String body) {
        return body != null && body.contains(SCHEMA_VERSION);
    }

    /** Message shown when a port answered but is not ScamCity. */
    static String wrongServiceMessage(String endpoint) {
        return "端口有服务但不是 ScamCity: " + endpoint
                + "（缺少 schemaVersion=" + SCHEMA_VERSION
                + "，常见原因是 Minecraft 的 Open to LAN 占用了该端口）";
    }

    /**
     * Minimal string-field reader.
     *
     * <p>A hand-rolled scanner keeps this class dependency-free for the
     * verification source set. It is intentionally permissive about the rest of
     * the document because {@link #normalise} is what actually decides whether
     * the value may be used.</p>
     */
    static String stringField(String json, String field) {
        String needle = '"' + field + '"';
        int at = json.indexOf(needle);
        if (at < 0) {
            return "";
        }
        int colon = json.indexOf(':', at + needle.length());
        if (colon < 0) {
            return "";
        }
        int open = json.indexOf('"', colon + 1);
        if (open < 0) {
            return "";
        }
        StringBuilder value = new StringBuilder();
        for (int index = open + 1; index < json.length(); index += 1) {
            char character = json.charAt(index);
            if (character == '\\' && index + 1 < json.length()) {
                value.append(json.charAt(index + 1));
                index += 1;
                continue;
            }
            if (character == '"') {
                return value.toString();
            }
            value.append(character);
        }
        return "";
    }
}
