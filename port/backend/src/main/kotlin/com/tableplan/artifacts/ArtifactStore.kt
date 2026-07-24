package com.tableplan.artifacts

import com.tableplan.config.TableplanProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials
import software.amazon.awssdk.auth.credentials.AwsSessionCredentials
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider
import software.amazon.awssdk.core.sync.RequestBody
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.S3Configuration
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest
import software.amazon.awssdk.services.s3.model.GetObjectRequest
import software.amazon.awssdk.services.s3.model.HeadObjectRequest
import software.amazon.awssdk.services.s3.model.NoSuchKeyException
import software.amazon.awssdk.services.s3.model.PutObjectRequest
import software.amazon.awssdk.services.s3.model.S3Exception
import software.amazon.awssdk.services.s3.model.ServerSideEncryption
import java.net.URI
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption

data class ArtifactMetadata(
    val key: String,
    val byteSize: Long,
)

interface ArtifactStore : AutoCloseable {
    fun put(key: String, bytes: ByteArray)

    fun get(key: String): ByteArray

    fun head(key: String): ArtifactMetadata?

    fun delete(key: String)

    override fun close() = Unit
}

@Configuration
class ArtifactStoreConfiguration {
    @Bean(destroyMethod = "close")
    fun artifactStore(properties: TableplanProperties): ArtifactStore {
        val configuration = properties.artifacts
        val maximumBytes = configuration.maxMegabytes.toLong() * BYTES_PER_MEGABYTE
        return when (configuration.mode.lowercase()) {
            "local" -> LocalArtifactStore(Path.of(configuration.localDirectory), maximumBytes)
            "s3" -> {
                require(configuration.bucket.isNotBlank()) {
                    "tableplan.artifacts.bucket must be configured when artifact mode is s3"
                }
                val builder =
                    S3Client.builder()
                        .region(Region.of(configuration.region))
                        .serviceConfiguration(
                            S3Configuration.builder()
                                .pathStyleAccessEnabled(configuration.pathStyleAccess)
                                .chunkedEncodingEnabled(configuration.chunkedEncodingEnabled)
                                .build(),
                        )
                if (configuration.endpoint.isNotBlank()) {
                    builder.endpointOverride(URI.create(configuration.endpoint))
                }
                if (configuration.accessKeyId.isNotBlank() || configuration.secretAccessKey.isNotBlank()) {
                    require(configuration.accessKeyId.isNotBlank() && configuration.secretAccessKey.isNotBlank()) {
                        "Both tableplan.artifacts.access-key-id and secret-access-key must be configured together"
                    }
                    val credentials =
                        if (configuration.sessionToken.isBlank()) {
                            AwsBasicCredentials.create(
                                configuration.accessKeyId,
                                configuration.secretAccessKey,
                            )
                        } else {
                            AwsSessionCredentials.create(
                                configuration.accessKeyId,
                                configuration.secretAccessKey,
                                configuration.sessionToken,
                            )
                        }
                    builder.credentialsProvider(StaticCredentialsProvider.create(credentials))
                }
                S3ArtifactStore(
                    builder.build(),
                    configuration.bucket,
                    maximumBytes,
                    configuration.sendServerSideEncryptionHeader,
                )
            }
            else -> throw IllegalArgumentException(
                "Unsupported tableplan.artifacts.mode '${configuration.mode}'; expected local or s3",
            )
        }
    }

    private companion object {
        const val BYTES_PER_MEGABYTE = 1024L * 1024L
    }
}

class LocalArtifactStore(
    directory: Path,
    private val maximumBytes: Long,
) : ArtifactStore {
    private val root = directory.toAbsolutePath().normalize()

    init {
        Files.createDirectories(root)
    }

    override fun put(key: String, bytes: ByteArray) {
        requireWithinLimit(bytes.size.toLong())
        val target = resolve(key)
        val parent = requireNotNull(target.parent)
        Files.createDirectories(parent)
        val temporary = Files.createTempFile(parent, ".artifact-", ".tmp")
        try {
            Files.write(temporary, bytes)
            try {
                Files.move(
                    temporary,
                    target,
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING,
                )
            } catch (_: AtomicMoveNotSupportedException) {
                Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING)
            }
        } finally {
            Files.deleteIfExists(temporary)
        }
    }

    override fun get(key: String): ByteArray {
        val target = resolve(key)
        requireWithinLimit(Files.size(target))
        return Files.readAllBytes(target)
    }

    override fun head(key: String): ArtifactMetadata? {
        val target = resolve(key)
        return if (Files.isRegularFile(target)) ArtifactMetadata(key, Files.size(target)) else null
    }

    override fun delete(key: String) {
        Files.deleteIfExists(resolve(key))
    }

    private fun resolve(key: String): Path {
        require(key.isNotBlank()) { "Artifact key must not be blank" }
        require(!key.startsWith("/") && !key.contains('\\')) { "Artifact key must be relative" }
        val target = root.resolve(key).normalize()
        require(target.startsWith(root) && target != root) { "Artifact key escapes the artifact directory" }
        return target
    }

    private fun requireWithinLimit(byteSize: Long) {
        require(byteSize <= maximumBytes) {
            "Artifact size $byteSize exceeds the configured maximum of $maximumBytes bytes"
        }
    }
}

class S3ArtifactStore(
    private val client: S3Client,
    private val bucket: String,
    private val maximumBytes: Long,
    private val sendServerSideEncryptionHeader: Boolean = true,
) : ArtifactStore {
    override fun put(key: String, bytes: ByteArray) {
        requireKey(key)
        requireWithinLimit(bytes.size.toLong())
        val request =
            PutObjectRequest.builder()
                .bucket(bucket)
                .key(key)
                .let { builder ->
                    if (sendServerSideEncryptionHeader) {
                        builder.serverSideEncryption(ServerSideEncryption.AES256)
                    } else {
                        builder
                    }
                }
                .build()
        client.putObject(request, RequestBody.fromBytes(bytes))
    }

    override fun get(key: String): ByteArray {
        val metadata = head(key) ?: throw NoSuchElementException("Artifact '$key' does not exist")
        requireWithinLimit(metadata.byteSize)
        return client.getObjectAsBytes(
            GetObjectRequest.builder().bucket(bucket).key(key).build(),
        ).asByteArray()
    }

    override fun head(key: String): ArtifactMetadata? {
        requireKey(key)
        return try {
            val response =
                client.headObject(
                    HeadObjectRequest.builder().bucket(bucket).key(key).build(),
                )
            ArtifactMetadata(key, response.contentLength())
        } catch (_: NoSuchKeyException) {
            null
        } catch (error: S3Exception) {
            if (error.statusCode() == 404) null else throw error
        }
    }

    override fun delete(key: String) {
        requireKey(key)
        client.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key).build())
    }

    override fun close() {
        client.close()
    }

    private fun requireKey(key: String) {
        require(key.isNotBlank() && !key.startsWith("/") && !key.contains('\\')) {
            "Artifact key must be a non-blank relative key"
        }
        require(key.split('/').none { it.isBlank() || it == "." || it == ".." }) {
            "Artifact key contains an invalid path segment"
        }
    }

    private fun requireWithinLimit(byteSize: Long) {
        require(byteSize <= maximumBytes) {
            "Artifact size $byteSize exceeds the configured maximum of $maximumBytes bytes"
        }
    }
}
