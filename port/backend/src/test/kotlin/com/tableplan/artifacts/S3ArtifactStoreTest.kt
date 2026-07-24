package com.tableplan.artifacts

import org.junit.jupiter.api.Test
import org.mockito.ArgumentCaptor
import org.mockito.ArgumentMatchers
import org.mockito.Mockito
import software.amazon.awssdk.core.sync.RequestBody
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.model.PutObjectRequest
import software.amazon.awssdk.services.s3.model.PutObjectResponse
import software.amazon.awssdk.services.s3.model.ServerSideEncryption
import kotlin.test.assertEquals
import kotlin.test.assertNull

class S3ArtifactStoreTest {
    @Test
    fun `can omit the unsupported server-side encryption header for R2`() {
        val client = Mockito.mock(S3Client::class.java)
        Mockito.`when`(
            client.putObject(
                ArgumentMatchers.any(PutObjectRequest::class.java),
                ArgumentMatchers.any(RequestBody::class.java),
            ),
        ).thenReturn(PutObjectResponse.builder().build())
        val request = ArgumentCaptor.forClass(PutObjectRequest::class.java)

        S3ArtifactStore(client, "bucket", 1_024, sendServerSideEncryptionHeader = false)
            .put("recipes/source.pdf", byteArrayOf(1, 2, 3))

        Mockito.verify(client).putObject(
            request.capture(),
            ArgumentMatchers.any(RequestBody::class.java),
        )
        assertNull(request.value.serverSideEncryption())
    }

    @Test
    fun `keeps the encryption header enabled for AWS S3 by default`() {
        val client = Mockito.mock(S3Client::class.java)
        Mockito.`when`(
            client.putObject(
                ArgumentMatchers.any(PutObjectRequest::class.java),
                ArgumentMatchers.any(RequestBody::class.java),
            ),
        ).thenReturn(PutObjectResponse.builder().build())
        val request = ArgumentCaptor.forClass(PutObjectRequest::class.java)

        S3ArtifactStore(client, "bucket", 1_024)
            .put("recipes/source.pdf", byteArrayOf(1, 2, 3))

        Mockito.verify(client).putObject(
            request.capture(),
            ArgumentMatchers.any(RequestBody::class.java),
        )
        assertEquals(ServerSideEncryption.AES256, request.value.serverSideEncryption())
    }
}
