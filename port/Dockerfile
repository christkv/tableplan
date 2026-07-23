FROM eclipse-temurin:21.0.8_9-jre-noble AS extractor

WORKDIR /opt/extract
COPY backend/build/libs/tableplan.jar tableplan.jar
RUN java -Djarmode=tools -jar tableplan.jar extract --launcher --layers --destination layers

FROM eclipse-temurin:21.0.8_9-jre-noble

RUN groupadd --system --gid 10001 tableplan \
    && useradd --system --uid 10001 --gid tableplan --home-dir /opt/tableplan tableplan \
    && mkdir -p /opt/tableplan/artifacts \
    && chown -R tableplan:tableplan /opt/tableplan

WORKDIR /opt/tableplan
COPY --from=extractor --chown=tableplan:tableplan /opt/extract/layers/dependencies/ ./
COPY --from=extractor --chown=tableplan:tableplan /opt/extract/layers/spring-boot-loader/ ./
COPY --from=extractor --chown=tableplan:tableplan /opt/extract/layers/snapshot-dependencies/ ./
COPY --from=extractor --chown=tableplan:tableplan /opt/extract/layers/application/ ./
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-Duser.timezone=UTC", "org.springframework.boot.loader.launch.JarLauncher"]
CMD ["serve"]
